/**
 * SDR Demodulator AudioWorklet Processor
 * Loaded as an ES module in AudioWorkletGlobalScope.
 *
 * Message in:  { type:'iq', i:ArrayBuffer, q:ArrayBuffer, mode, squelch_dbfs, sample_rate }
 * Output:      mono float32 PCM at 48 kHz
 */

registerProcessor('sdr-demod-processor', class extends AudioWorkletProcessor {

    constructor() {
        super();
        this._mode       = 'WFM';
        this._squelch    = -120;
        this._sampleRate = 2048000;
        this._buf        = [];
        this._wfmPrevI   = 1;
        this._wfmPrevQ   = 0;
        this._amDc       = 0;

        this.port.onmessage = (ev) => {
            const { type, i, q, mode, squelch_dbfs, sample_rate } = ev.data;
            if (type !== 'iq') return;
            if (mode         !== undefined) this._mode       = mode;
            if (squelch_dbfs !== undefined) this._squelch    = squelch_dbfs;
            if (sample_rate  !== undefined) this._sampleRate = sample_rate;

            const iArr = new Float32Array(i);
            const qArr = new Float32Array(q);
            const audio = this._demodulate(iArr, qArr);
            for (let k = 0; k < audio.length; k++) this._buf.push(audio[k]);
        };
    }

    _powerDbfs(i, q) {
        let sum = 0;
        for (let k = 0; k < i.length; k++) sum += i[k] * i[k] + q[k] * q[k];
        return 10 * Math.log10(sum / i.length + 1e-20);
    }

    _demodulate(i, q) {
        if (this._powerDbfs(i, q) < this._squelch) {
            return new Float32Array(Math.round(i.length * 48000 / this._sampleRate));
        }
        switch (this._mode) {
            case 'WFM': return this._demodFM(i, q);
            case 'NFM': return this._demodFM(i, q);
            case 'AM':  return this._demodAM(i, q);
            case 'USB': return this._demodSSB(i, q,  1);
            case 'LSB': return this._demodSSB(i, q, -1);
            default:    return this._demodAM(i, q);
        }
    }

    _demodFM(i, q) {
        const n = i.length;
        const disc = new Float32Array(n);
        let pI = this._wfmPrevI;
        let pQ = this._wfmPrevQ;
        for (let k = 0; k < n; k++) {
            const re =  i[k] * pI + q[k] * pQ;
            const im =  q[k] * pI - i[k] * pQ;
            disc[k] = Math.atan2(im, re);
            pI = i[k]; pQ = q[k];
        }
        this._wfmPrevI = pI;
        this._wfmPrevQ = pQ;
        return this._downsample(disc, this._sampleRate, 48000);
    }

    _demodAM(i, q) {
        const n = i.length;
        const env = new Float32Array(n);
        const alpha = 0.0005;
        let dc = this._amDc;
        for (let k = 0; k < n; k++) {
            const mag = Math.sqrt(i[k] * i[k] + q[k] * q[k]);
            dc += alpha * (mag - dc);
            env[k] = mag - dc;
        }
        this._amDc = dc;
        return this._downsample(env, this._sampleRate, 48000);
    }

    _demodSSB(i, q, sign) {
        const n = i.length;
        const out = new Float32Array(n);
        for (let k = 0; k < n; k++) out[k] = i[k] + sign * q[k];
        return this._downsample(out, this._sampleRate, 48000);
    }

    _downsample(input, inRate, outRate) {
        const ratio  = inRate / outRate;
        const outLen = Math.floor(input.length / ratio);
        const out    = new Float32Array(outLen);
        for (let k = 0; k < outLen; k++) {
            const src  = k * ratio;
            const lo   = src | 0;
            const frac = src - lo;
            const hi   = lo + 1 < input.length ? lo + 1 : lo;
            out[k] = input[lo] + frac * (input[hi] - input[lo]);
        }
        return out;
    }

    process(_inputs, outputs) {
        const out  = outputs[0][0];
        if (!out) return true;
        const need = out.length;
        if (this._buf.length >= need) {
            out.set(this._buf.splice(0, need));
        } else {
            out.fill(0);
        }
        return true;
    }
});
