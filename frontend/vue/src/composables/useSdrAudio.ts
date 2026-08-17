// SDR audio composable — app-level singleton.
// AudioContext, AudioWorkletNode, and WebSockets are plain module-level
// variables — NEVER in Vue reactive state (proxy wrapping breaks audio APIs).
//
// This migrates the full sdr-audio.ts IIFE to a composable.

import { useSdrStore } from '@/stores/sdr'
import type { SdrMode } from '@/stores/sdr'

// ── Module-level audio state (never reactive) ────────────────────────────────
let _ctx: AudioContext | null = null
/**
 * The subset of `AudioWorkletNode` this module drives.
 *
 * Widened from the concrete class because audio has two implementations now:
 * the worklet, and a `ScriptProcessorNode` fallback for pages that cannot use
 * one. `AudioWorkletNode` satisfies this as-is, so every call site below is
 * unchanged and neither path is the special case.
 */
interface DemodNode {
  readonly port: {
    postMessage(message: unknown, transfer?: Transferable[]): void
    onmessage: ((event: MessageEvent) => void) | null
  }
  connect(destination: AudioNode): unknown
  disconnect(): void
}

let _worklet: DemodNode | null = null
/** Extra teardown the fallback needs, or null when the worklet path is in use. */
let _fallbackTeardown: (() => void) | null = null
let _gain: GainNode | null = null
// User-set output volume.
let _volume = 1.0

/** Owner of a live mute. Each owner mutes and unmutes independently. */
export type LiveMuteReason = 'playback' | 'digital' | 'aprs'
/**
 * What a mute applies to: a specific radio id, or 'all' for "whichever radio is
 * currently audible".
 */
export type LiveMuteTarget = number | 'all'

// Live-mute state, keyed by target and owner. Two things make the extra
// structure necessary:
//   • Multiple independent owners (a saved recording playing back, digital-voice
//     decode, APRS decode). With one boolean, whichever unmuted last silently
//     lifted the others' mute.
//   • Decode owners must mute only THEIR radio. Decoding on one dongle must
//     never silence another dongle the user is listening to — today only the
//     selected radio is audible, but the keys are already per-radio so several
//     concurrent audio streams need no rework here.
// Recording playback targets 'all': it mutes whatever is live, whichever radio
// that is. The effective gain is _volume unless the driven radio is muted, then
// 0 — the IQ stream (and so the signal meter / waterfall / spectrum) keeps
// running either way.
const _liveMuteReasons = new Map<LiveMuteTarget, Set<LiveMuteReason>>()

/** Whether audio for `radioId` is muted by any owner ('all' owners included). */
function _isRadioLiveMuted(radioId: number | null): boolean {
  if ((_liveMuteReasons.get('all')?.size ?? 0) > 0) return true
  if (radioId == null) return false
  return (_liveMuteReasons.get(radioId)?.size ?? 0) > 0
}
let _iqSocket: WebSocket | null = null
let _radioId: number | null = null
let _ready = false

/**
 * Why audio could not start, or null when it can.
 *
 * Audio init used to end in a bare `catch { _ctx = null }`, which meant every
 * possible failure — an unsupported browser, a blocked context, a worklet that
 * would not register — produced silence and an empty console. Diagnosing "the
 * waterfall works but there is no sound" then meant reading this file, because
 * the running app had destroyed the only evidence.
 *
 * The commonest cause by far is the page not being a secure context.
 * `AudioWorklet` is gated on one, and Sentinel is normally reached over plain
 * HTTP at a LAN address — which is secure on `localhost` and insecure on
 * `10.10.10.1`, so the same build plays on the machine hosting it and is silent
 * on every other device. That is worth naming explicitly rather than reporting
 * as a generic failure.
 */
let _unavailableReason: string | null = null
// In-flight audio init, shared by concurrent callers so the worklet module is
// only added once per context (a second addModule() throws "already registered").
let _initPromise: Promise<void> | null = null
let _mode = 'AM'
let _squelch = -120
// Demod frequency offset from the hardware centre (Hz). Non-zero only when
// auto-centre is OFF and the user has clicked away from centre. Sent with every
// IQ block (like _mode) so it survives worklet recreation.
let _offsetHz = 0
let _iqReconnectTimer: ReturnType<typeof setTimeout> | null = null
let _iqReconnectDelay = 500
const IQ_RECONNECT_MAX = 30000

// Recording state
let _isRecording = false
let _collectingChunks = false
let _recStartTime: Date | null = null
let _recId: number | null = null
let _recChunks: Float32Array[] = []

// Power/squelch callbacks (set by SdrPanel)
let _onPower: ((dbfs: number, squelchOpen: boolean) => void) | null = null
let _onSquelchChange: ((open: boolean) => void) | null = null
const _onRecChunk: ((samples: Float32Array) => void) | null = null

// ── AudioWorklet processor (inlined) ─────────────────────────────────────────
const PROCESSOR_SRC = `registerProcessor('sdr-demod-processor', class extends AudioWorkletProcessor {
    constructor() {
        super();
        this._mode='AM'; this._squelch=-120; this._sampleRate=2048000;
        // Small ring + tight latency cap. IQ arrives over a WebSocket whose
        // effective sample rate can drift slightly off the AudioContext's
        // 48kHz output, so without a cap any net inflow > outflow grows the
        // buffered audio without bound — the symptom is audio drifting
        // seconds behind the waterfall. _maxBuffered is the target ceiling
        // (≈150 ms); on overflow the read pointer is fast-forwarded to drop
        // the oldest samples so playback stays close to real-time.
        this._pcmBuf=new Float32Array(48000*1); this._pcmWr=0; this._pcmRd=0; this._pcmLen=0;
        this._preroll=Math.round(48000*0.08); this._buffering=true;
        this._maxBuffered=Math.round(48000*0.15);
        this._powerTick=0;
        this._squelchStateLast=false;
        this._wfmPrevI=1; this._wfmPrevQ=0; this._amDc=0;
        this._bwHz=0;
        this._deemphY=0;
        // Fractional resampler state. Output rate is fixed at 48000 Hz; input
        // rate (this._sampleRate) is whatever the dongle delivers — typically
        // 1.024M / 1.536M / 1.792M / 2.048M, none integer multiples of 48000.
        // Integer-D decimation produced a ~1.5% rate mismatch (e.g. 2.048M/43
        // = 47628 Hz), so the playback ring buffer slowly over/underflowed and
        // periodically dropped samples or re-prerolled — audible as jumpy
        // WFM. _resPhase is a per-input-sample phase accumulator carried
        // across blocks; _resPrev holds the last input sample for the linear
        // interpolation that straddles block boundaries.
        this._resPhase=0; this._resPrev=0;
        // NCO frequency shift. When the user tunes off the hardware centre with
        // auto-centre OFF, the wanted signal sits _offsetHz away from DC in the
        // IQ stream. Mixing by e^(-j2πf n / sr) shifts it down to baseband so
        // the existing demodulators (which assume the signal is at DC) work
        // unchanged. _ncoPhase is a continuous accumulator (radians) carried
        // across blocks so there is no phase discontinuity at block edges.
        this._offsetHz=0;
        this._ncoPhase=0;
        this._lpfTaps=null; this._lpfBw=0; this._lpfSr=0;
        this._lpfDelayI=null; this._lpfDelayQ=null; this._lpfPos=0;
        // Pre-LPF integer IQ decimator. The 64-tap FIR in _lpf is O(64·N) per
        // block — at 2.048 Msps that's ~262 M mul-adds/sec on the audio thread,
        // enough to glitch WFM (wide BW → LPF active → full-rate FIR). Boxcar-
        // decimating IQ by an integer factor F first reduces N by F and brings
        // the bwRatio back above the LPF-skip threshold for wide modes like
        // WFM. _effectiveSr is the rate AFTER this decimation; mix/LPF/demod
        // and the post-demod fractional resample all use it instead of the raw
        // hardware sample rate so timing stays correct.
        this._iqDecim=1; this._effectiveSr=2048000;
        this._iqDecimAccI=0; this._iqDecimAccQ=0; this._iqDecimCount=0;
        this._isRecording=false;
        this._recChunkSize=4800;
        this._recChunkBuf=new Float32Array(this._recChunkSize);
        this._recChunkPos=0;
        this._squelchOpen=false;
        this._squelchTail=0;
        this.port.onmessage=(ev)=>{
            const{type,i,q,mode,squelch_dbfs,sample_rate,bandwidth_hz,offset_hz}=ev.data;
            if(type==='reset'){this._pcmWr=0;this._pcmRd=0;this._pcmLen=0;this._buffering=true;this._resPhase=0;this._resPrev=0;this._iqDecimAccI=0;this._iqDecimAccQ=0;this._iqDecimCount=0;return;}
            if(type==='rec_start'){this._isRecording=true;this._recChunkPos=0;this._squelchOpen=false;this._squelchTail=0;this._squelchStateLast=false;return;}
            if(type==='rec_stop'){
                this._isRecording=false;
                if(this._recChunkPos>0){
                    this.port.postMessage({type:'pcm_chunk',samples:this._recChunkBuf.slice(0,this._recChunkPos)});
                    this._recChunkPos=0;
                }
                return;
            }
            if(type==='bw'){if(bandwidth_hz!==undefined)this._bwHz=bandwidth_hz;return;}
            if(type==='offset'){if(offset_hz!==undefined)this._offsetHz=offset_hz;return;}
            if(type!=='iq')return;
            if(mode!==undefined)this._mode=mode;
            if(squelch_dbfs!==undefined)this._squelch=squelch_dbfs;
            if(sample_rate!==undefined)this._sampleRate=sample_rate;
            if(offset_hz!==undefined)this._offsetHz=offset_hz;
            let iA=new Float32Array(i),qA=new Float32Array(q);
            // Choose integer IQ decimation so the LPF (if needed) runs over
            // ≤~1 Msps and bwRatio stays in the cheap "skip LPF" zone for wide
            // modes. Floor of 1.0 Msps keeps NFM/AM sharp; ceiling = factor 8.
            const targetMaxSr=Math.max(this._bwHz*2.2, 1024000);
            let decim=1;
            while(decim<8 && this._sampleRate/(decim*2) >= targetMaxSr) decim*=2;
            // Decimation factor changed mid-stream → drop carried partial
            // accumulator and re-prime the fractional resampler so the audio
            // ring doesn't see a sample-rate discontinuity.
            if(decim!==this._iqDecim){
                this._iqDecim=decim;
                this._iqDecimAccI=0;this._iqDecimAccQ=0;this._iqDecimCount=0;
                this._resPhase=0;this._resPrev=0;
                this._lpfTaps=null; // force rebuild at new rate
            }
            this._effectiveSr=this._sampleRate/decim;
            if(decim>1){const r=this._decIq(iA,qA,decim);iA=r.iD;qA=r.qD;}
            if(this._offsetHz!==0)this._mix(iA,qA);
            // Channel low-pass filter — isolates the selected frequency to the
            // tuning-bar span. It MUST run whenever the bar is narrower than the
            // IQ stream; skipping it lets the demodulator see the whole FFT span
            // so every signal in range plays at once. (A former bwRatio<0.35
            // skip — a CPU shortcut — caused exactly that for wide bars.) The
            // pre-LPF integer decimator already caps the FIR's input rate, so
            // running it unconditionally is affordable. Only skip when the bar
            // genuinely covers the whole stream (bwRatio>=~1, nothing to filter).
            const bwRatio=this._bwHz>0?this._bwHz/this._effectiveSr:1;
            const{iF,qF}=bwRatio>0&&bwRatio<0.95?this._lpf(iA,qA):{iF:iA,qF:qA};
            const audio=this._demod(iF,qF);
            const cap=this._pcmBuf.length;
            for(let k=0;k<audio.length;k++){
                this._pcmBuf[this._pcmWr]=audio[k];this._pcmWr=(this._pcmWr+1)%cap;
                if(this._pcmLen<cap)this._pcmLen++;else this._pcmRd=(this._pcmRd+1)%cap;
            }
            if(this._pcmLen>this._maxBuffered){const drop=this._pcmLen-this._maxBuffered;this._pcmRd=(this._pcmRd+drop)%cap;this._pcmLen=this._maxBuffered;}
            if(this._buffering&&this._pcmLen>=this._preroll)this._buffering=false;
            if(this._isRecording&&this._squelchOpen){
                for(let k=0;k<audio.length;k++){
                    this._recChunkBuf[this._recChunkPos++]=audio[k];
                    if(this._recChunkPos>=this._recChunkSize){
                        this.port.postMessage({type:'pcm_chunk',samples:this._recChunkBuf.slice(0)});
                        this._recChunkPos=0;
                    }
                }
            }
        };
    }
    _buildLpf(cutHz,sr){const M=64,fc=cutHz/sr;const taps=new Float32Array(M+1);let sum=0;for(let n=0;n<=M;n++){const h=n===M/2?2*Math.PI*fc:Math.sin(2*Math.PI*fc*(n-M/2))/(n-M/2);const w=0.54-0.46*Math.cos(2*Math.PI*n/M);taps[n]=h*w;sum+=taps[n];}for(let n=0;n<=M;n++)taps[n]/=sum;return taps;}
    _lpf(i,q){const sr=this._effectiveSr,bw=this._bwHz;if(this._lpfTaps===null||this._lpfBw!==bw||this._lpfSr!==sr){this._lpfTaps=this._buildLpf(bw/2,sr);const M=this._lpfTaps.length;this._lpfDelayI=new Float32Array(M);this._lpfDelayQ=new Float32Array(M);this._lpfPos=0;this._lpfBw=bw;this._lpfSr=sr;}const taps=this._lpfTaps,M=taps.length;const dI=this._lpfDelayI,dQ=this._lpfDelayQ;const oI=new Float32Array(i.length),oQ=new Float32Array(q.length);let pos=this._lpfPos;for(let k=0;k<i.length;k++){dI[pos]=i[k];dQ[pos]=q[k];let sI=0,sQ=0;for(let j=0;j<M;j++){const p=(pos-j+M)%M;sI+=taps[j]*dI[p];sQ+=taps[j]*dQ[p];}oI[k]=sI;oQ[k]=sQ;pos=(pos+1)%M;}this._lpfPos=pos;return{iF:oI,qF:oQ};}
    _mix(i,q){const n=i.length,sr=this._effectiveSr;const dPh=-2*Math.PI*this._offsetHz/sr;let ph=this._ncoPhase;for(let k=0;k<n;k++){const c=Math.cos(ph),s=Math.sin(ph);const re=i[k]*c-q[k]*s,im=i[k]*s+q[k]*c;i[k]=re;q[k]=im;ph+=dPh;if(ph>Math.PI)ph-=2*Math.PI;else if(ph<-Math.PI)ph+=2*Math.PI;}this._ncoPhase=ph;}
    // Boxcar IQ decimator by integer F. Sums F input samples → 1 output. State
    // (_iqDecimAccI/Q, _iqDecimCount) carries a partial sum across blocks so
    // any input length works. Cheap (1 add per input sample, no FIR), and its
    // sinc-shaped magnitude response has its first null at sr/F — well outside
    // any demod bandwidth we'd allow given the targetMaxSr=bw*2.2 ceiling.
    _decIq(iIn,qIn,F){const n=iIn.length;const outLen=Math.floor((this._iqDecimCount+n)/F);const iD=new Float32Array(outLen);const qD=new Float32Array(outLen);let aI=this._iqDecimAccI,aQ=this._iqDecimAccQ,c=this._iqDecimCount,oi=0,inv=1/F;for(let k=0;k<n;k++){aI+=iIn[k];aQ+=qIn[k];if(++c===F){iD[oi]=aI*inv;qD[oi]=aQ*inv;oi++;aI=0;aQ=0;c=0;}}this._iqDecimAccI=aI;this._iqDecimAccQ=aQ;this._iqDecimCount=c;return{iD:oi===outLen?iD:iD.subarray(0,oi),qD:oi===outLen?qD:qD.subarray(0,oi)};}
    _pwr(i,q){let s=0;for(let k=0;k<i.length;k++)s+=i[k]*i[k]+q[k]*q[k];return 10*Math.log10(s/i.length+1e-20);}
    _demod(i,q){const dbfs=this._pwr(i,q);if(++this._powerTick>=8){this._powerTick=0;this.port.postMessage({type:'power',dbfs,squelchOpen:this._squelchOpen});}const open=dbfs>=this._squelch;if(open){this._squelchOpen=true;this._squelchTail=Math.round(48000*1.5);}else if(this._squelchOpen){const tailSamples=Math.round(i.length*48000/this._effectiveSr);if(this._squelchTail>tailSamples){this._squelchTail-=tailSamples;}else{this._squelchOpen=false;this._squelchTail=0;}}if(this._squelchOpen!==this._squelchStateLast){this._squelchStateLast=this._squelchOpen;this.port.postMessage({type:'squelch_change',open:this._squelchOpen});}if(!open)return new Float32Array(Math.round(i.length*48000/this._effectiveSr));if(this._mode==='AM')return this._am(i,q);if(this._mode==='USB')return this._ssb(i,q,1);if(this._mode==='LSB')return this._ssb(i,q,-1);if(this._mode==='WFM')return this._wfm(i,q);return this._fm(i,q);}
    _fm(i,q){const n=i.length,d=new Float32Array(n);let pI=this._wfmPrevI,pQ=this._wfmPrevQ;for(let k=0;k<n;k++){const re=i[k]*pI+q[k]*pQ,im=q[k]*pI-i[k]*pQ;d[k]=Math.atan2(im,re);pI=i[k];pQ=q[k];}this._wfmPrevI=pI;this._wfmPrevQ=pQ;return this._decimate(d,this._effectiveSr,48000);}
    _wfm(i,q){const n=i.length,d=new Float32Array(n);let pI=this._wfmPrevI,pQ=this._wfmPrevQ;for(let k=0;k<n;k++){const re=i[k]*pI+q[k]*pQ,im=q[k]*pI-i[k]*pQ;d[k]=Math.atan2(im,re);pI=i[k];pQ=q[k];}this._wfmPrevI=pI;this._wfmPrevQ=pQ;const pcm=this._decimate(d,this._effectiveSr,48000);const alpha=Math.exp(-1/(48000*75e-6));const beta=1-alpha;let y=this._deemphY;for(let k=0;k<pcm.length;k++){y=alpha*y+beta*pcm[k];pcm[k]=y;}this._deemphY=y;return pcm;}
    _am(i,q){const n=i.length,e=new Float32Array(n);const a=1/(this._effectiveSr*0.05);let dc=this._amDc;for(let k=0;k<n;k++){const m=Math.sqrt(i[k]*i[k]+q[k]*q[k]);dc+=a*(m-dc);e[k]=m-dc;}this._amDc=dc;return this._decimate(e,this._effectiveSr,48000);}
    _ssb(i,q,s){const o=new Float32Array(i.length);for(let k=0;k<i.length;k++)o[k]=i[k]+s*q[k];return this._decimate(o,this._effectiveSr,48000);}
    _decimate(inp,inR,outR){const step=inR/outR;if(step<=1)return inp;const n=inp.length;const est=Math.ceil((n-this._resPhase)/step)+1;const o=new Float32Array(est);let oi=0,ph=this._resPhase;const prev=this._resPrev;while(ph<n){const idx=Math.floor(ph),frac=ph-idx;const a=idx===0?prev:inp[idx-1];const b=inp[idx];o[oi++]=a+(b-a)*frac;ph+=step;}this._resPhase=ph-n;this._resPrev=inp[n-1];return oi===est?o:o.subarray(0,oi);}
    process(_,outputs){const out=outputs[0][0];if(!out)return true;const need=out.length;if(this._buffering||this._pcmLen<need){out.fill(0);return true;}const cap=this._pcmBuf.length;for(let k=0;k<need;k++){out[k]=this._pcmBuf[this._pcmRd];this._pcmRd=(this._pcmRd+1)%cap;}this._pcmLen-=need;if(this._pcmLen===0)this._buffering=true;return true;}
});`

// ── WAV encoder ───────────────────────────────────────────────────────────────
function _encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  let totalSamples = 0
  for (const c of chunks) totalSamples += c.length
  const numBytes = totalSamples * 2
  const buf = new ArrayBuffer(44 + numBytes)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + numBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, numBytes, true)
  let off = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(off, Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767))), true)
      off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// ── Gesture listeners for AudioContext resume ──────────────────────────────────
function _resumeOnGesture() {
  if (!_ctx || _ctx.state !== 'suspended') return
  _ctx
    .resume()
    .then(() => {
      /* v8 ignore start -- _worklet is always set when a suspended _ctx exists */
      if (_worklet) _worklet.port.postMessage({ type: 'reset' })
      /* v8 ignore stop */
    })
    .catch(() => {})
}
const _gestureEvents = ['pointerdown', 'touchend', 'keydown'] as const
function _addGestureListeners() {
  _gestureEvents.forEach((ev) =>
    window.addEventListener(ev, _resumeOnGesture, { capture: true, passive: true }),
  )
}
function _removeGestureListeners() {
  _gestureEvents.forEach((ev) =>
    window.removeEventListener(ev, _resumeOnGesture, { capture: true }),
  )
}
function _watchContextState() {
  /* v8 ignore start -- _ctx is always set when called from _initAudio */
  if (!_ctx) return
  /* v8 ignore stop */
  _ctx.addEventListener('statechange', function onSC() {
    if (_ctx && _ctx.state === 'running') {
      _removeGestureListeners()
      ;(_ctx as AudioContext).removeEventListener('statechange', onSC)
    }
  })
}

// ── IQ Socket ────────────────────────────────────────────────────────────────
function _openIqSocket(radioId: number) {
  if (_iqReconnectTimer) {
    clearTimeout(_iqReconnectTimer)
    _iqReconnectTimer = null
  }
  if (_iqSocket) {
    _iqSocket.close()
    _iqSocket = null
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}/iq`)
  ws.binaryType = 'arraybuffer'
  _iqSocket = ws
  ws.addEventListener('open', () => {
    _iqReconnectDelay = 500
    if (_ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {})
    if (_worklet) _worklet.port.postMessage({ type: 'reset' })
  })
  ws.addEventListener('message', (ev: MessageEvent) => {
    if (!_ready || !_worklet || !(ev.data instanceof ArrayBuffer)) return
    const buf = ev.data as ArrayBuffer
    if (buf.byteLength < 9) return
    const view = new DataView(buf)
    const sampleRate = view.getUint32(0, true)
    const iqBytes = new Uint8Array(buf, 8)
    const n = iqBytes.length >> 1
    const i = new Float32Array(n)
    const q = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      i[k] = (iqBytes[k * 2] - 127.5) / 127.5
      q[k] = (iqBytes[k * 2 + 1] - 127.5) / 127.5
    }
    _worklet!.port.postMessage(
      {
        type: 'iq',
        i: i.buffer,
        q: q.buffer,
        mode: _mode,
        squelch_dbfs: _squelch,
        sample_rate: sampleRate,
        offset_hz: _offsetHz,
      },
      [i.buffer, q.buffer],
    )
  })
  ws.addEventListener('close', () => {
    _iqSocket = null
    const delay = _iqReconnectDelay
    _iqReconnectDelay = Math.min(_iqReconnectDelay * 2, IQ_RECONNECT_MAX)
    _iqReconnectTimer = setTimeout(() => {
      if (_radioId === radioId) _openIqSocket(radioId)
    }, delay)
  })
  ws.addEventListener('error', () => {})
}

// ── Audio init ────────────────────────────────────────────────────────────────
// Coalesce concurrent init calls: a second initAudio() that arrives while the
// first is still awaiting addModule() would otherwise add the worklet module to
// the same context twice, throwing "AudioWorkletProcessor ... already registered".
function _initAudio(): Promise<void> {
  if (_ctx && _ready) return Promise.resolve()
  if (!_initPromise) {
    _initPromise = _doInitAudio().finally(() => {
      _initPromise = null
    })
  }
  return _initPromise
}

/** The reason `AudioWorklet` is unusable here, or null when it is available. */
function _workletBlocker(ctx: AudioContext): string | null {
  if (ctx.audioWorklet) return null
  // Checked in this order because the secure-context rule is the actionable
  // case: it is a property of the URL, not the browser, so the fix is how the
  // page is reached rather than which device it is opened on.
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    return (
      'Audio needs a secure context. This page is served over plain HTTP at a ' +
      'non-localhost address, so the browser blocks the audio worklet. Reach ' +
      'Sentinel over HTTPS or via localhost to hear audio.'
    )
  }
  return 'This browser does not support AudioWorklet, which Sentinel needs for audio.'
}

/**
 * How many frames the fallback renders per callback.
 *
 * 8192 at 48 kHz is ~170 ms. A `ScriptProcessorNode` runs on the **main
 * thread**, competing with the waterfall and everything else the UI does, so
 * the callback arrives whenever the browser gets round to it rather than on the
 * audio thread's fixed cadence. 4096 (~85 ms) was audibly jumpy on a phone:
 * too little work per callback to absorb that jitter.
 *
 * The cost is latency, which for listening to a receiver is a fair trade
 * against dropouts — tuning feedback stays well under a quarter-second.
 */
const FALLBACK_BUFFER_SIZE = 8192

/**
 * Buffering the fallback asks the processor for, in seconds.
 *
 * The processor's own defaults (80 ms preroll, 150 ms ceiling) are tuned for
 * the worklet, where callbacks land on the audio thread like clockwork. On the
 * main thread each callback drains {@link FALLBACK_BUFFER_SIZE} frames at once,
 * so a 150 ms ceiling leaves barely a callback's worth of slack — and the ring
 * spends its time alternating between underrun (silence while it refills) and
 * overflow, where it fast-forwards past the oldest samples. That fast-forward
 * *is* the jump you hear.
 *
 * Roughly triple the headroom, well inside the processor's one-second buffer.
 */
const FALLBACK_PREROLL_S = 0.25
const FALLBACK_MAX_BUFFERED_S = 0.5
const OUTPUT_SAMPLE_RATE = 48000

/** The processor class the source registers, as this module uses it. */
interface DemodProcessor {
  process(inputs: unknown, outputs: Float32Array[][]): boolean
  /** Frames buffered before playback starts, and the ceiling before it drops. */
  _preroll: number
  _maxBuffered: number
}

/**
 * Run the demodulator on the main thread, for pages that cannot use a worklet.
 *
 * `AudioWorklet` is gated on a secure context, and Sentinel is normally reached
 * over plain HTTP at a LAN address — so on every device except the one hosting
 * it, the worklet path is simply unavailable and audio was silent.
 * `ScriptProcessorNode` is deprecated but carries no such gate, so it restores
 * audio everywhere with no certificates.
 *
 * **The DSP is not duplicated.** The exact same `PROCESSOR_SRC` is evaluated
 * here with `registerProcessor` and `AudioWorkletProcessor` shimmed, so both
 * paths run byte-identical demodulation and a change to the algorithm cannot
 * apply to only one of them. The source depends on nothing else from the
 * worklet scope — no `sampleRate`, no `currentTime` — which is what makes this
 * possible.
 *
 * Returns null when the source cannot be evaluated at all, which a page with a
 * strict `script-src` (no `unsafe-eval`) would cause; the caller then reports
 * the original worklet blocker rather than a confusing second failure.
 */
function _createFallbackNode(ctx: AudioContext): DemodNode | null {
  let ProcessorClass: (new () => DemodProcessor) | null = null
  // A real MessageChannel rather than a hand-rolled pair: it gives the same
  // async delivery and structured-clone semantics as a worklet port, including
  // the transferables the IQ path relies on, so the processor cannot tell the
  // difference.
  const channel = new MessageChannel()
  class ProcessorBase {
    port = channel.port2
  }
  try {
    new Function('registerProcessor', 'AudioWorkletProcessor', PROCESSOR_SRC)(
      (_name: string, cls: new () => DemodProcessor) => {
        ProcessorClass = cls
      },
      ProcessorBase,
    )
    // One catch, not two. Everything that can go wrong here is handled the
    // same way — a page whose CSP forbids `unsafe-eval` so the source cannot be
    // evaluated, a source that registered nothing (leaving `ProcessorClass`
    // null, which the construction below throws on), or a browser with no
    // `createScriptProcessor`. In every case the caller reports the original
    // worklet blocker, which is the half an operator can act on.
    return _buildFallbackGraph(
      ctx,
      new (ProcessorClass as unknown as new () => DemodProcessor)(),
      channel,
    )
  } catch {
    channel.port1.close()
    channel.port2.close()
    return null
  }
}

/** Wire the demodulator into a ScriptProcessor graph. Throws if the nodes are unavailable. */
function _buildFallbackGraph(
  ctx: AudioContext,
  processor: DemodProcessor,
  channel: MessageChannel,
): DemodNode {
  // Set directly rather than messaged in: the processor is an ordinary object
  // on this thread, which is the one advantage this path has over the worklet.
  processor._preroll = Math.round(OUTPUT_SAMPLE_RATE * FALLBACK_PREROLL_S)
  processor._maxBuffered = Math.round(OUTPUT_SAMPLE_RATE * FALLBACK_MAX_BUFFERED_S)

  const node = ctx.createScriptProcessor(FALLBACK_BUFFER_SIZE, 1, 1)
  node.onaudioprocess = (event: AudioProcessingEvent) => {
    // `process` fills the array it is handed, exactly as the worklet calls it.
    processor.process(null, [[event.outputBuffer.getChannelData(0)]])
  }

  // A ScriptProcessorNode with nothing feeding it does not reliably fire its
  // callback — Safari in particular wants a live input. A constant source at
  // zero costs nothing audible and guarantees the graph pulls on it.
  const silence = ctx.createConstantSource()
  silence.offset.value = 0
  silence.connect(node)
  silence.start()

  _fallbackTeardown = () => {
    node.onaudioprocess = null
    try {
      silence.stop()
    } catch {
      // Already stopped, which is not a failure worth surfacing.
    }
    silence.disconnect()
    channel.port1.close()
    channel.port2.close()
  }

  return {
    port: channel.port1,
    connect: (destination: AudioNode) => node.connect(destination),
    disconnect: () => node.disconnect(),
  }
}

/**
 * Tell iOS this is media playback, not incidental sound.
 *
 * Web Audio on iOS defaults to the "ambient" audio category, which the phone's
 * physical ring/silent switch mutes — while video, notifications and most apps
 * are unaffected. The failure is total silence with no error anywhere: the
 * graph builds, `process()` runs, and nothing comes out. That is the state this
 * fixes, and it is not something an operator can be expected to guess.
 *
 * Relying on a hardware toggle for a receiver to be audible is the wrong
 * default for an SDR — the point of tuning it is to hear it — so `playback` is
 * set unconditionally rather than offered as a preference. It also keeps audio
 * running when the screen locks.
 *
 * `navigator.audioSession` is Safari 16.4+ and absent everywhere else, so this
 * is inert on every other browser.
 */
function _configureAudioSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = 'playback'
  } catch {
    // A read-only or restricted property throws under strict mode. Audio is
    // still worth attempting — it simply stays subject to the silent switch.
  }
}

async function _doInitAudio() {
  _unavailableReason = null
  try {
    if (typeof AudioContext === 'undefined') {
      throw new Error('This browser has no Web Audio support.')
    }
    const blob = new Blob([PROCESSOR_SRC], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    // A failed init always nulls _ctx, so on entry _ctx is either null or fully
    // ready; the "_ctx already set" branch here is unreachable in practice.
    /* v8 ignore start */
    if (!_ctx) {
      /* v8 ignore stop */
      const earlyCtx = (window as Window & { _sdrEarlyCtx?: AudioContext })._sdrEarlyCtx
      if (earlyCtx) {
        _ctx = earlyCtx
        delete (window as Window & { _sdrEarlyCtx?: AudioContext })._sdrEarlyCtx
      } else _ctx = new AudioContext({ sampleRate: 48000 })
      // Before the first resume, so the category is in force for the context's
      // whole life rather than applied to one that is already running.
      _configureAudioSession()
      _watchContextState()
    }
    _ctx.resume().catch(() => {})
    const blocker = _workletBlocker(_ctx)
    if (blocker) {
      // Not fatal any more: the same demodulator runs on the main thread, which
      // is what makes audio work on the plain-HTTP LAN address Sentinel is
      // normally reached at.
      URL.revokeObjectURL(blobUrl)
      _worklet = _createFallbackNode(_ctx)
      if (!_worklet) throw new Error(blocker)
      console.info('[sentinel] audio: %s Using the ScriptProcessor fallback.', blocker)
    } else {
      await _ctx.audioWorklet.addModule(blobUrl)
      URL.revokeObjectURL(blobUrl)
      _worklet = new AudioWorkletNode(_ctx, 'sdr-demod-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
    }
    _gain = _ctx.createGain()
    _gain.gain.value = _isRadioLiveMuted(_radioId) ? 0 : _volume
    _worklet.connect(_gain)
    _gain.connect(_ctx.destination)
    _worklet.port.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (!msg) return
      if (msg.type === 'power') _onPower?.(msg.dbfs as number, msg.squelchOpen as boolean)
      if (msg.type === 'squelch_change') _onSquelchChange?.(msg.open as boolean)
      if (msg.type === 'pcm_chunk' && _collectingChunks)
        _recChunks.push(new Float32Array(msg.samples))
      if (msg.type === 'pcm_chunk') _onRecChunk?.(new Float32Array(msg.samples))
    }
    _ready = true
  } catch (error) {
    // Recorded and logged rather than swallowed. `_ctx` is still nulled so a
    // later attempt starts clean, but the reason now outlives the failure and
    // reaches both the console and anything rendering `audioUnavailableReason`.
    _unavailableReason = error instanceof Error ? error.message : String(error)
    console.warn('[sentinel] audio unavailable:', _unavailableReason)
    _ctx = null
  }
}

// ── Module-level one-time setup ───────────────────────────────────────────────
_addGestureListeners()

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    if (_ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {})
    if (_radioId != null && !_iqSocket) _openIqSocket(_radioId)
  }
})

// ── Public composable ─────────────────────────────────────────────────────────
export function useSdrAudio() {
  const sdrStore = useSdrStore()

  async function initAudio(radioId?: number) {
    if (radioId != null) _radioId = radioId
    const hadWorklet = _worklet !== null
    await _initAudio()
    if (_radioId != null && !_iqSocket) {
      _openIqSocket(_radioId)
    } else if (!hadWorklet && _iqSocket && _iqSocket.readyState === WebSocket.OPEN && _worklet) {
      _worklet.port.postMessage({ type: 'reset' })
    }
    sdrStore.setPlaying(true)
  }

  function stop() {
    if (_iqSocket) {
      _iqSocket.close()
      _iqSocket = null
    }
    _ready = false
    if (_worklet) {
      _worklet.port.onmessage = null
      _worklet.disconnect()
      _worklet = null
    }
    if (_fallbackTeardown) {
      _fallbackTeardown()
      _fallbackTeardown = null
    }
    if (_gain) {
      _gain.disconnect()
      _gain = null
    }
    if (_ctx) {
      _ctx.close()
      _ctx = null
    }
    sdrStore.setPlaying(false)
    _addGestureListeners()
  }

  function setRadioId(id: number) {
    _radioId = id
    // Which radio is driven decides whose mute applies, so re-evaluate the gain
    // rather than leaving the previous radio's mute in force.
    applyGain()
    if (_ready) _openIqSocket(id)
  }

  function setMode(mode: SdrMode) {
    _mode = mode
    sdrStore.setMode(mode)
  }

  function setSquelch(dbfs: number) {
    _squelch = dbfs
  }

  function applyGain() {
    if (_gain) _gain.gain.value = _isRadioLiveMuted(_radioId) ? 0 : _volume
  }

  function setVolume(volume: number) {
    _volume = Math.max(0, Math.min(2, volume))
    applyGain()
  }

  /**
   * Mute or unmute the live SDR audio without touching the IQ stream, so the
   * signal meter / waterfall / spectrum keep updating. Unmuting restores the
   * user's current volume.
   *
   * @param muted  Whether this owner wants the audio muted.
   * @param reason Which owner is asking — owners never lift each other's mute.
   * @param target The radio to mute, or 'all' for whichever radio is audible
   *   (recording playback). Decode owners pass their own radio id so another
   *   radio the user is listening to stays audible.
   */
  function setLiveMuted(
    muted: boolean,
    reason: LiveMuteReason = 'playback',
    target: LiveMuteTarget = 'all',
  ) {
    // An owner holds at most one mute at a time, so drop this reason everywhere
    // before re-applying it. That also covers the owner moving between radios
    // (APRS restarted on another dongle) without stranding a mute on the old one.
    for (const [key, reasons] of _liveMuteReasons) {
      reasons.delete(reason)
      if (reasons.size === 0) _liveMuteReasons.delete(key)
    }
    if (muted) {
      const reasons = _liveMuteReasons.get(target) ?? new Set<LiveMuteReason>()
      reasons.add(reason)
      _liveMuteReasons.set(target, reasons)
    }
    applyGain()
  }

  /** Whether audio for `radioId` is currently muted by any owner. */
  function isRadioLiveMuted(radioId: number | null) {
    return _isRadioLiveMuted(radioId)
  }

  function setBandwidthHz(hz: number) {
    if (_worklet) _worklet.port.postMessage({ type: 'bw', bandwidth_hz: hz })
  }

  // Demod offset from the hardware centre frequency (Hz). 0 = demod at centre
  // (auto-centre ON, or marker at centre). Non-zero shifts the demodulator to a
  // signal that is off-centre in the IQ stream WITHOUT retuning the hardware,
  // so the spectrum/waterfall display stays put. Persisted at module scope and
  // re-sent with every IQ block so it survives a worklet recreation.
  function setOffsetHz(hz: number) {
    _offsetHz = hz
    if (_worklet) _worklet.port.postMessage({ type: 'offset', offset_hz: hz })
  }

  function onPower(cb: (dbfs: number, squelchOpen: boolean) => void) {
    _onPower = cb
  }
  function onSquelchChange(cb: (open: boolean) => void) {
    _onSquelchChange = cb
  }

  async function startRecording(metadata: {
    radio_id?: number | null
    radio_name?: string
    frequency_hz?: number
    mode?: string
    gain_db?: number
    squelch_dbfs?: number
    sample_rate?: number
  }): Promise<number | null> {
    if (!_ready || !_worklet) return null
    try {
      const res = await fetch('/api/sdr/recordings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radio_id: metadata.radio_id ?? null,
          radio_name: metadata.radio_name || '',
          frequency_hz: metadata.frequency_hz || 0,
          mode: metadata.mode || 'AM',
          gain_db: metadata.gain_db ?? 30.0,
          squelch_dbfs: metadata.squelch_dbfs ?? -60.0,
          sample_rate: metadata.sample_rate || 2048000,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { id: number }
      _recId = data.id
    } catch {
      return null
    }
    _isRecording = true
    _collectingChunks = true
    _recChunks = []
    _recStartTime = new Date()
    _worklet.port.postMessage({ type: 'rec_start' })
    return _recId
  }

  async function stopRecording(metadata: {
    frequency_hz?: number
    mode?: string
    name?: string
  }): Promise<unknown> {
    if (!_isRecording) return null
    _isRecording = false
    const endTime = new Date()
    if (_worklet) _worklet.port.postMessage({ type: 'rec_stop' })
    await new Promise((r) => setTimeout(r, 400))
    _collectingChunks = false
    // NOTE: computed but not currently sent to the backend (only ended_at is). Latent.
    // _recStartTime is always set while recording, so the `|| endTime` fallback is defensive.
    /* v8 ignore start */
    const _startedAt = (_recStartTime || endTime).toISOString().replace(/\.\d{3}Z$/, 'Z')
    /* v8 ignore stop */
    const endedAt = endTime.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const freqMhz = metadata.frequency_hz ? (metadata.frequency_hz / 1e6).toFixed(3) : null
    const mode = metadata.mode || null
    const defaultName =
      [freqMhz ? `${freqMhz} MHz` : null, mode].filter(Boolean).join(' · ') || 'Recording'
    const chunks = _recChunks
    _recChunks = []
    const recId = _recId
    _recId = null
    _recStartTime = null
    if (chunks.length === 0) {
      try {
        await fetch(`/api/sdr/recordings/${recId}`, { method: 'DELETE' })
      } catch {}
      return null
    }
    let totalSamples = 0
    for (const c of chunks) totalSamples += c.length
    const durationS = (totalSamples / 48000).toFixed(2)
    const wav = _encodeWav(chunks, 48000)
    const form = new FormData()
    form.append('file', wav, 'recording.wav')
    form.append('recording_id', String(recId))
    form.append('name', metadata.name || defaultName)
    form.append('ended_at', endedAt)
    form.append('duration_s', durationS)
    try {
      const res = await fetch('/api/sdr/recordings/stop', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch {
      try {
        await fetch(`/api/sdr/recordings/${recId}`, { method: 'DELETE' })
      } catch {}
      return null
    }
  }

  function isReady() {
    return _ready
  }
  /**
   * Why audio is not playing, or null when nothing is wrong.
   *
   * Populated only once an init has been attempted — before that there is
   * nothing to report and null means "not tried yet" rather than "fine".
   */
  function audioUnavailableReason() {
    return _unavailableReason
  }
  function isPlaying() {
    return sdrStore.playing
  }

  return {
    initAudio,
    stop,
    setRadioId,
    setMode,
    setSquelch,
    setVolume,
    setLiveMuted,
    isRadioLiveMuted,
    setBandwidthHz,
    setOffsetHz,
    startRecording,
    stopRecording,
    onPower,
    onSquelchChange,
    isReady,
    isPlaying,
    audioUnavailableReason,
  }
}
