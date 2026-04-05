"use strict";
// ============================================================
// SDR AUDIO — Web Audio demodulator (real IQ stream)
//
// Opens a second WebSocket to /ws/sdr/{id}/iq which streams
// raw binary IQ frames from rtl_tcp.  Feeds an AudioWorklet
// that demodulates to PCM audio.
//
// Binary frame format (little-endian):
//   bytes 0-3  : uint32 sample_rate
//   bytes 4-7  : uint32 center_hz
//   bytes 8+   : uint8 IQ pairs (I, Q, I, Q, …)
//
// Exposes window._SdrAudio = { start, stop, setRadioId, setMode, setSquelch, setVolume }
// ============================================================
/// <reference path="./globals.d.ts" />
(function buildSdrAudio() {
    let _ctx = null;
    let _worklet = null;
    let _gain = null;
    let _iqSocket = null;
    let _radioId = null;
    let _ready = false;
    let _mode = 'AM';
    let _squelch = -120;
    // Processor source inlined to avoid Safari blob/fetch/proxy issues with addModule
    const PROCESSOR_SRC = `registerProcessor('sdr-demod-processor', class extends AudioWorkletProcessor {
    constructor() {
        super();
        this._mode='AM'; this._squelch=-120; this._sampleRate=2048000;
        // Circular PCM buffer — 48000*2 = 2s capacity; pre-roll 0.08s before playing
        this._pcmBuf=new Float32Array(48000*2); this._pcmWr=0; this._pcmRd=0; this._pcmLen=0;
        this._preroll=Math.round(48000*0.08); this._buffering=true;
        this._wfmPrevI=1; this._wfmPrevQ=0; this._amDc=0;
        this._bwHz=0; // 0 = full bandwidth
        // WFM de-emphasis IIR state (75µs time constant)
        this._deemphY=0;
        // FIR LPF taps (updated when bw or sample_rate changes)
        this._lpfTaps=null; this._lpfBw=0; this._lpfSr=0;
        // FIR delay line for I and Q channels
        this._lpfDelayI=null; this._lpfDelayQ=null; this._lpfPos=0;
        this.port.onmessage=(ev)=>{
            const{type,i,q,mode,squelch_dbfs,sample_rate,bandwidth_hz}=ev.data;
            if(type==='bw'){if(bandwidth_hz!==undefined)this._bwHz=bandwidth_hz;return;}
            if(type!=='iq')return;
            if(mode!==undefined)this._mode=mode;
            if(squelch_dbfs!==undefined)this._squelch=squelch_dbfs;
            if(sample_rate!==undefined)this._sampleRate=sample_rate;
            const iA=new Float32Array(i),qA=new Float32Array(q);
            // Apply FIR LPF only when BW is narrow enough to need it (skip for WFM — decimation handles it)
            const bwRatio=this._bwHz>0?this._bwHz/this._sampleRate:1;
            const{iF,qF}=bwRatio>0&&bwRatio<0.35
                ?this._lpf(iA,qA)
                :{iF:iA,qF:qA};
            const audio=this._demod(iF,qF);
            const cap=this._pcmBuf.length;
            for(let k=0;k<audio.length;k++){
                if(this._pcmLen<cap){this._pcmBuf[this._pcmWr]=audio[k];this._pcmWr=(this._pcmWr+1)%cap;this._pcmLen++;}
            }
            if(this._buffering&&this._pcmLen>=this._preroll)this._buffering=false;
        };
    }
    // Build windowed-sinc FIR low-pass taps (Hamming window, M=64 taps)
    _buildLpf(cutHz,sr){
        const M=64,fc=cutHz/sr;
        const taps=new Float32Array(M+1);
        let sum=0;
        for(let n=0;n<=M;n++){
            const h=n===M/2?2*Math.PI*fc:Math.sin(2*Math.PI*fc*(n-M/2))/(n-M/2);
            const w=0.54-0.46*Math.cos(2*Math.PI*n/M); // Hamming
            taps[n]=h*w; sum+=taps[n];
        }
        for(let n=0;n<=M;n++)taps[n]/=sum;
        return taps;
    }
    _lpf(i,q){
        const sr=this._sampleRate,bw=this._bwHz;
        if(this._lpfTaps===null||this._lpfBw!==bw||this._lpfSr!==sr){
            this._lpfTaps=this._buildLpf(bw/2,sr);
            const M=this._lpfTaps.length;
            this._lpfDelayI=new Float32Array(M);
            this._lpfDelayQ=new Float32Array(M);
            this._lpfPos=0;
            this._lpfBw=bw;this._lpfSr=sr;
        }
        const taps=this._lpfTaps,M=taps.length;
        const dI=this._lpfDelayI,dQ=this._lpfDelayQ;
        const oI=new Float32Array(i.length),oQ=new Float32Array(q.length);
        let pos=this._lpfPos;
        for(let k=0;k<i.length;k++){
            dI[pos]=i[k];dQ[pos]=q[k];
            let sI=0,sQ=0;
            for(let j=0;j<M;j++){const p=(pos-j+M)%M;sI+=taps[j]*dI[p];sQ+=taps[j]*dQ[p];}
            oI[k]=sI;oQ[k]=sQ;
            pos=(pos+1)%M;
        }
        this._lpfPos=pos;
        return{iF:oI,qF:oQ};
    }
    _pwr(i,q){let s=0;for(let k=0;k<i.length;k++)s+=i[k]*i[k]+q[k]*q[k];return 10*Math.log10(s/i.length+1e-20);}
    _demod(i,q){
        const dbfs=this._pwr(i,q);
        this.port.postMessage({type:'power',dbfs});
        if(dbfs<this._squelch)return new Float32Array(Math.round(i.length*48000/this._sampleRate));
        if(this._mode==='AM')return this._am(i,q);
        if(this._mode==='USB')return this._ssb(i,q,1);
        if(this._mode==='LSB')return this._ssb(i,q,-1);
        if(this._mode==='WFM')return this._wfm(i,q);
        return this._fm(i,q);
    }
    _fm(i,q){
        const n=i.length,d=new Float32Array(n);
        let pI=this._wfmPrevI,pQ=this._wfmPrevQ;
        for(let k=0;k<n;k++){const re=i[k]*pI+q[k]*pQ,im=q[k]*pI-i[k]*pQ;d[k]=Math.atan2(im,re);pI=i[k];pQ=q[k];}
        this._wfmPrevI=pI;this._wfmPrevQ=pQ;
        return this._decimate(d,this._sampleRate,48000);
    }
    _wfm(i,q){
        // FM discriminator (same as NFM)
        const n=i.length,d=new Float32Array(n);
        let pI=this._wfmPrevI,pQ=this._wfmPrevQ;
        for(let k=0;k<n;k++){const re=i[k]*pI+q[k]*pQ,im=q[k]*pI-i[k]*pQ;d[k]=Math.atan2(im,re);pI=i[k];pQ=q[k];}
        this._wfmPrevI=pI;this._wfmPrevQ=pQ;
        // Decimate to 48 kHz
        const pcm=this._decimate(d,this._sampleRate,48000);
        // 75µs de-emphasis IIR: y[n] = alpha*y[n-1] + (1-alpha)*x[n]
        // alpha = exp(-1 / (48000 * 75e-6))
        const alpha=Math.exp(-1/(48000*75e-6));
        const beta=1-alpha;
        let y=this._deemphY;
        for(let k=0;k<pcm.length;k++){y=alpha*y+beta*pcm[k];pcm[k]=y;}
        this._deemphY=y;
        return pcm;
    }
    _am(i,q){
        const n=i.length,e=new Float32Array(n);
        // DC removal: time constant ~0.05s at input sample rate
        const a=1/(this._sampleRate*0.05);let dc=this._amDc;
        for(let k=0;k<n;k++){const m=Math.sqrt(i[k]*i[k]+q[k]*q[k]);dc+=a*(m-dc);e[k]=m-dc;}
        this._amDc=dc;return this._decimate(e,this._sampleRate,48000);
    }
    _ssb(i,q,s){const o=new Float32Array(i.length);for(let k=0;k<i.length;k++)o[k]=i[k]+s*q[k];return this._decimate(o,this._sampleRate,48000);}
    // Decimate with boxcar (moving-average) anti-alias filter.
    // Decimation factor D = round(inR/outR). Filter averages D samples per output.
    _decimate(inp,inR,outR){
        const D=Math.round(inR/outR);
        if(D<=1)return inp;
        const n=Math.floor(inp.length/D),o=new Float32Array(n);
        const inv=1/D;
        for(let k=0;k<n;k++){
            let s=0,base=k*D;
            for(let j=0;j<D;j++)s+=inp[base+j];
            o[k]=s*inv;
        }
        return o;
    }
    process(_,outputs){
        const out=outputs[0][0];if(!out)return true;
        const need=out.length;
        if(this._buffering||this._pcmLen<need){out.fill(0);return true;}
        const cap=this._pcmBuf.length;
        for(let k=0;k<need;k++){out[k]=this._pcmBuf[this._pcmRd];this._pcmRd=(this._pcmRd+1)%cap;}
        this._pcmLen-=need;
        // Only re-buffer if completely empty — avoid thrashing
        if(this._pcmLen===0)this._buffering=true;
        return true;
    }
});`;
    async function _initAudio() {
        if (_ctx)
            return;
        try {
            const blob = new Blob([PROCESSOR_SRC], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            _ctx = new AudioContext({ sampleRate: 48000 });
            _ctx.resume().catch(() => { });
            await _ctx.audioWorklet.addModule(blobUrl);
            URL.revokeObjectURL(blobUrl);
            _worklet = new AudioWorkletNode(_ctx, 'sdr-demod-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
            });
            _gain = _ctx.createGain();
            _gain.gain.value = 1.0;
            _worklet.connect(_gain);
            _gain.connect(_ctx.destination);
            _worklet.port.onmessage = (ev) => {
                if (ev.data?.type === 'power' && window._SdrControls) {
                    window._SdrControls.updateSignalBar(ev.data.dbfs);
                }
            };
            _ready = true;
            console.log('[SdrAudio] ready');
        }
        catch (e) {
            console.warn('[SdrAudio] AudioWorklet init failed:', e);
            _ctx = null;
        }
    }
    let _iqReconnectTimer = null;
    function _openIqSocket(radioId) {
        if (_iqReconnectTimer) {
            clearTimeout(_iqReconnectTimer);
            _iqReconnectTimer = null;
        }
        if (_iqSocket) {
            _iqSocket.close();
            _iqSocket = null;
        }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}/iq`);
        ws.binaryType = 'arraybuffer';
        _iqSocket = ws;
        ws.addEventListener('message', (ev) => {
            if (!_ready || !_worklet || !(ev.data instanceof ArrayBuffer))
                return;
            const buf = ev.data;
            if (buf.byteLength < 9)
                return; // need at least header + 1 byte
            const view = new DataView(buf);
            const sampleRate = view.getUint32(0, true);
            // center_hz at bytes 4-7 (not needed in worklet but parsed for completeness)
            const iqBytes = new Uint8Array(buf, 8);
            const n = iqBytes.length >> 1; // number of IQ pairs
            // Convert uint8 → normalised float32 [-1, 1]
            const i = new Float32Array(n);
            const q = new Float32Array(n);
            for (let k = 0; k < n; k++) {
                i[k] = (iqBytes[k * 2] - 127.5) / 127.5;
                q[k] = (iqBytes[k * 2 + 1] - 127.5) / 127.5;
            }
            _worklet.port.postMessage({
                type: 'iq',
                i: i.buffer,
                q: q.buffer,
                mode: _mode,
                squelch_dbfs: _squelch,
                sample_rate: sampleRate,
            }, [i.buffer, q.buffer]);
        });
        ws.addEventListener('close', () => {
            _iqSocket = null;
            // Auto-reconnect after 1.5s — handles retune-triggered drops
            _iqReconnectTimer = setTimeout(() => {
                if (_radioId === radioId)
                    _openIqSocket(radioId);
            }, 1500);
        });
        ws.addEventListener('error', () => {
            console.warn('[SdrAudio] IQ WebSocket error');
        });
    }
    async function start(radioId) {
        // Only open the IQ socket — audio must be inited via a user gesture separately
        const id = radioId ?? _radioId;
        if (id != null) {
            _radioId = id;
            _openIqSocket(id);
        }
    }
    // Call this from a user gesture (click/keydown) to init the AudioContext
    async function initAudio(radioId) {
        if (radioId != null)
            _radioId = radioId;
        await _initAudio();
        if (_ctx && _ctx.state === 'suspended') {
            await _ctx.resume();
        }
        if (_radioId != null && !_iqSocket) {
            _openIqSocket(_radioId);
        }
    }
    function stop() {
        if (_iqSocket) {
            _iqSocket.close();
            _iqSocket = null;
        }
        _ready = false;
        if (_worklet) {
            _worklet.port.onmessage = null;
            _worklet.disconnect();
            _worklet = null;
        }
        if (_gain) {
            _gain.disconnect();
            _gain = null;
        }
        if (_ctx) {
            _ctx.close();
            _ctx = null;
        }
        if (window._SdrControls)
            window._SdrControls.setStatus(false);
    }
    function setRadioId(id) {
        _radioId = id;
        if (_ready)
            _openIqSocket(id);
    }
    function setMode(mode) {
        _mode = mode;
    }
    function setSquelch(dbfs) {
        _squelch = dbfs;
    }
    function setVolume(v) {
        if (_gain)
            _gain.gain.value = Math.max(0, Math.min(2, v));
    }
    function setBandwidthHz(hz) {
        if (_worklet)
            _worklet.port.postMessage({ type: 'bw', bandwidth_hz: hz });
    }
    window._SdrAudio = { start, initAudio, stop, setRadioId, setMode, setSquelch, setVolume, setBandwidthHz };
})();
