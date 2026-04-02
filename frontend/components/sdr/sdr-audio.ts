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

    let _ctx:       AudioContext | null = null;
    let _worklet:   AudioWorkletNode | null = null;
    let _gain:      GainNode | null = null;
    let _iqSocket:  WebSocket | null = null;
    let _radioId:   number | null = null;
    let _ready      = false;
    let _mode       = 'AM';
    let _squelch    = -120;

    // Processor source inlined to avoid Safari blob/fetch/proxy issues with addModule
    const PROCESSOR_SRC = `registerProcessor('sdr-demod-processor', class extends AudioWorkletProcessor {
    constructor() {
        super();
        this._mode='AM'; this._squelch=-120; this._sampleRate=2048000;
        this._buf=[]; this._wfmPrevI=1; this._wfmPrevQ=0; this._amDc=0;
        this._bwHz=0; // 0 = full bandwidth
        this.port.onmessage=(ev)=>{
            const{type,i,q,mode,squelch_dbfs,sample_rate,bandwidth_hz}=ev.data;
            if(type==='bw'){if(bandwidth_hz!==undefined)this._bwHz=bandwidth_hz;return;}
            if(type!=='iq')return;
            if(mode!==undefined)this._mode=mode;
            if(squelch_dbfs!==undefined)this._squelch=squelch_dbfs;
            if(sample_rate!==undefined)this._sampleRate=sample_rate;
            const iA=new Float32Array(i),qA=new Float32Array(q);
            // Apply bandwidth limiting: only use centre portion of IQ chunk
            const{iT,qT}=this._bwHz>0?this._trim(iA,qA,sample_rate):({iT:iA,qT:qA});
            const audio=this._demod(iT,qT);
            for(let k=0;k<audio.length;k++)this._buf.push(audio[k]);
        };
    }
    _trim(i,q,sr){
        // Keep only the centre (bwHz/sr) fraction of samples
        const frac=Math.min(1,this._bwHz/sr);
        const keep=Math.max(1,Math.floor(i.length*frac));
        const off=Math.floor((i.length-keep)/2);
        return{iT:i.subarray(off,off+keep),qT:q.subarray(off,off+keep)};
    }
    _pwr(i,q){let s=0;for(let k=0;k<i.length;k++)s+=i[k]*i[k]+q[k]*q[k];return 10*Math.log10(s/i.length+1e-20);}
    _demod(i,q){
        if(this._pwr(i,q)<this._squelch)return new Float32Array(Math.round(i.length*48000/this._sampleRate));
        if(this._mode==='AM')return this._am(i,q);
        if(this._mode==='USB')return this._ssb(i,q,1);
        if(this._mode==='LSB')return this._ssb(i,q,-1);
        return this._fm(i,q);
    }
    _fm(i,q){
        const n=i.length,d=new Float32Array(n);
        let pI=this._wfmPrevI,pQ=this._wfmPrevQ;
        for(let k=0;k<n;k++){const re=i[k]*pI+q[k]*pQ,im=q[k]*pI-i[k]*pQ;d[k]=Math.atan2(im,re);pI=i[k];pQ=q[k];}
        this._wfmPrevI=pI;this._wfmPrevQ=pQ;
        return this._decimate(d,this._sampleRate,48000);
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
        if(this._buf.length>=need)out.set(this._buf.splice(0,need));else out.fill(0);
        return true;
    }
});`;

    async function _initAudio() {
        if (_ctx) return;
        try {
            const blob    = new Blob([PROCESSOR_SRC], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            _ctx = new AudioContext({ sampleRate: 48000 });
            _ctx.resume().catch(() => {});
            await _ctx.audioWorklet.addModule(blobUrl);
            URL.revokeObjectURL(blobUrl);
            _worklet = new AudioWorkletNode(_ctx, 'sdr-demod-processor', {
                numberOfInputs:  0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
            });
            _gain = _ctx.createGain();
            _gain.gain.value = 1.0;
            _worklet.connect(_gain);
            _gain.connect(_ctx.destination);
            _ready = true;
            console.log('[SdrAudio] ready');
        } catch (e) {
            console.warn('[SdrAudio] AudioWorklet init failed:', e);
            _ctx = null;
        }
    }

    let _iqReconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function _openIqSocket(radioId: number) {
        if (_iqReconnectTimer) { clearTimeout(_iqReconnectTimer); _iqReconnectTimer = null; }
        if (_iqSocket) { _iqSocket.close(); _iqSocket = null; }

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}/iq`);
        ws.binaryType = 'arraybuffer';
        _iqSocket = ws;

        ws.addEventListener('message', (ev: MessageEvent) => {
            if (!_ready || !_worklet || !(ev.data instanceof ArrayBuffer)) return;
            const buf = ev.data as ArrayBuffer;
            if (buf.byteLength < 9) return; // need at least header + 1 byte

            const view       = new DataView(buf);
            const sampleRate = view.getUint32(0, true);
            // center_hz at bytes 4-7 (not needed in worklet but parsed for completeness)
            const iqBytes    = new Uint8Array(buf, 8);
            const n          = iqBytes.length >> 1; // number of IQ pairs

            // Convert uint8 → normalised float32 [-1, 1]
            const i = new Float32Array(n);
            const q = new Float32Array(n);
            for (let k = 0; k < n; k++) {
                i[k] = (iqBytes[k * 2]     - 127.5) / 127.5;
                q[k] = (iqBytes[k * 2 + 1] - 127.5) / 127.5;
            }

            _worklet!.port.postMessage({
                type:         'iq',
                i:            i.buffer,
                q:            q.buffer,
                mode:         _mode,
                squelch_dbfs: _squelch,
                sample_rate:  sampleRate,
            }, [i.buffer, q.buffer]);
        });

        ws.addEventListener('close', () => {
            _iqSocket = null;
            // Auto-reconnect after 1.5s — handles retune-triggered drops
            _iqReconnectTimer = setTimeout(() => {
                if (_radioId === radioId) _openIqSocket(radioId);
            }, 1500);
        });

        ws.addEventListener('error', () => {
            console.warn('[SdrAudio] IQ WebSocket error');
        });
    }

    async function start(radioId?: number) {
        // Only open the IQ socket — audio must be inited via a user gesture separately
        const id = radioId ?? _radioId;
        if (id != null) {
            _radioId = id;
            _openIqSocket(id);
        }
    }

    // Call this from a user gesture (click/keydown) to init the AudioContext
    async function initAudio(radioId?: number) {
        if (radioId != null) _radioId = radioId;
        await _initAudio();
        if (_ctx && _ctx.state === 'suspended') {
            await _ctx.resume();
        }
        if (_radioId != null && !_iqSocket) {
            _openIqSocket(_radioId);
        }
    }

    function stop() {
        if (_iqSocket) { _iqSocket.close(); _iqSocket = null; }
        _ready = false;
        if (_worklet) { _worklet.disconnect(); _worklet = null; }
        if (_gain)    { _gain.disconnect();    _gain    = null; }
        if (_ctx)     { _ctx.close();          _ctx     = null; }
    }

    function setRadioId(id: number) {
        _radioId = id;
        if (_ready) _openIqSocket(id);
    }

    function setMode(mode: string) {
        _mode = mode;
    }

    function setSquelch(dbfs: number) {
        _squelch = dbfs;
    }

    function setVolume(v: number) {
        if (_gain) _gain.gain.value = Math.max(0, Math.min(2, v));
    }

    function setBandwidthHz(hz: number) {
        if (_worklet) _worklet.port.postMessage({ type: 'bw', bandwidth_hz: hz });
    }

    // pushFrame is a no-op now — real IQ comes over the binary socket
    function pushFrame(_frame: SdrSpectrumFrame) {}

    window._SdrAudio = { start, initAudio, stop, pushFrame, setRadioId, setMode, setSquelch, setVolume, setBandwidthHz };
})();
