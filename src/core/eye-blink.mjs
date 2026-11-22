// A short asymmetric eyelid gesture keyed to the actor's entrance.
export function eyeBlinkAt(actor, definition, time) {
  const settings = definition.eyeBlink;
  if (actor.blink === false || !settings?.enabled || !settings.parameterIds?.length) return 1;
  const interval = Number.isFinite(settings.mean) ? Math.max(0.65, settings.mean) : 3;
  const elapsed = Math.max(0, time - (actor.animationStartedAt ?? 0));
  let seed = 0;
  for (const ch of actor.instanceId ?? '') seed = (seed * 31 + ch.codePointAt(0)) >>> 0;
  const untilOpen = (elapsed + interval * (seed % 17) / 40) % interval;
  const phase = untilOpen - (interval - 0.18);
  if (phase <= 0) return 1;
  const t = phase < 0.06 ? 1 - phase / 0.06 : (phase - 0.06) / 0.12;
  return t * t * (3 - 2 * t);
}
