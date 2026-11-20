export type Cue = "jump" | "crew" | "recruit" | "hurt" | "floor" | "win" | "launch";

const notes: Record<Exclude<Cue, "launch">, number[]> = {
  jump: [220, 320], crew: [392, 523], recruit: [440, 554, 659],
  hurt: [156, 98], floor: [392, 494, 587], win: [392, 494, 587, 784],
};

export function playCue(context: AudioContext | null, cue: Cue) {
  if (context?.state !== "running") return;
  if (cue === "launch") return distantRumble(context);
  const duration = cue === "jump" ? 0.05 : 0.095;
  notes[cue].forEach((frequency, index) => {
    const start = context.currentTime + index * duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue === "hurt" ? "sawtooth" : "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.065, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  });
}

function distantRumble(context: AudioContext) {
  const duration = 1.65;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  const start = context.currentTime;
  filter.frequency.setValueAtTime(160, start);
  filter.frequency.exponentialRampToValueAtTime(540, start + 0.45);
  filter.frequency.exponentialRampToValueAtTime(110, start + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.24, start + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  return () => { source.stop(); source.disconnect(); };
}
