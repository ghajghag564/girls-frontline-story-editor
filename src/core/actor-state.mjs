import {eyeBlinkAt} from './eye-blink.mjs';
import {isSpeakingActor} from './speakers.mjs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ramp = value => {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
};

function poseFor(expression, parameters) {
  const pose = new Map();
  for (const setting of expression?.parameters ?? []) {
    const range = parameters.get(setting.id);
    if (!range || !Number.isFinite(setting.value)) continue;
    const value = pose.get(setting.id) ?? range.default;
    const next = setting.blend === 'Add' ? value + setting.value
      : setting.blend === 'Multiply' ? value * setting.value : setting.value;
    pose.set(setting.id, clamp(next, range.min, range.max));
  }
  return pose;
}

function expressionDeltas(actor, expressions, parameters, time) {
  const output = new Map();
  const expressionFor = id => {
    if (id == null) return null;
    const value = expressions.get(id);
    if (!value) throw new Error('缺少人物表情 ' + id);
    return value;
  };
  const addPose = (expression, weight) => {
    for (const [id, value] of poseFor(expression, parameters)) {
      const neutral = parameters.get(id).default;
      output.set(id, (output.get(id) ?? 0) + (value - neutral) * weight);
    }
  };
  let event = actor.expressionTrack;
  if (!event || event.assetId !== actor.assetId || event.expression !== (actor.expression ?? null)) {
    addPose(expressionFor(actor.expression), 1);
    return output;
  }
  // Each change crossfades from the pose visible at its start. Seeking is frame-order independent.
  let previousWeight = 1;
  while (event && previousWeight > 0.0001) {
    if (time >= event.start) {
      const current = expressionFor(event.expression);
      const prior = expressionFor(event.previous?.expression);
      const seconds = Math.max(0, current?.fadeIn ?? 0, prior?.fadeOut ?? 0);
      const amount = seconds > 0 ? ramp((time - event.start) / seconds) : 1;
      if (amount > 0) addPose(current, previousWeight * amount);
      previousWeight *= 1 - amount;
      time = event.start;
    }
    event = event.previous;
  }
  return output;
}

export function actorParameters(actor, definition, state) {
  const parameters = new Map((definition.parameters ?? []).map(spec => [spec.id, spec]));
  const expressions = new Map((definition.expressions ?? []).map(expression => [expression.id, expression]));
  const deltas = expressionDeltas(actor, expressions, parameters, state.time);
  const values = Object.create(null);
  for (const [name, delta] of deltas) {
    const range = parameters.get(name);
    values[name] = clamp(range.default + delta, range.min, range.max);
  }
  const blink = eyeBlinkAt(actor, definition, state.time);
  for (const name of definition.eyeBlink?.parameterIds ?? []) {
    const range = parameters.get(name);
    if (range && blink < 1) values[name] = clamp((values[name] ?? range.default) * blink, range.min, range.max);
  }
  const mouth = parameters.get('ParamMouthOpenY');
  if (mouth && actor.mouth !== false && (state.mouthSpeaking ?? state.speaking) &&
      isSpeakingActor(state.entry.line, actor.instanceId)) {
    const start = state.entry.speech?.starts.get(actor.instanceId)?.since ?? state.entry.start + state.entry.transition;
    const elapsed = Math.max(0, state.time - start);
    const phase = (elapsed * 5.5) % 1;
    const open = ramp(phase < 0.4 ? phase / 0.4 : (1 - phase) / 0.6);
    const rest = values[mouth.id] ?? mouth.default;
    values[mouth.id] = clamp(rest + Math.max(0, Math.min(1, mouth.max) - rest) * 0.85 * open, mouth.min, mouth.max);
  }
  return values;
}

export const defaultStagePositions = [['左',.2],['左中',.35],['中',.5],['右中',.65],['右',.8]];

export function defaultActorPlacement(definition) {
  const placement = definition?.defaultPlacement;
  return {
    x: Number.isFinite(placement?.x) ? clamp(placement.x, -5, 5) : .5,
    y: Number.isFinite(placement?.y) ? clamp(placement.y, -5, 5) : 1.12,
    scale: Number.isFinite(placement?.scale) ? clamp(placement.scale, .01, 10) : 1,
  };
}

export function actorTransform(actor, definition, canvas, width, height) {
  const bounds = definition.framing?.bounds ?? [0, 0, 1, 1];
  const [left, top, right, bottom] = bounds;
  const drawableHeight = bottom - top;
  if (!(drawableHeight > 0)) throw new Error('人物取景范围无效');
  const imageHeight = height * (actor.scale ?? 1) / drawableHeight;
  const imageWidth = imageHeight * canvas.size[0] / canvas.size[1];
  const horizontalCenter = (left + right) / 2;
  const flip = actor.flip ? -1 : 1;
  const x = (actor.x ?? .5) * width + flip * (canvas.origin[0] / canvas.size[0] - horizontalCenter) * imageWidth;
  const y = (actor.y ?? 1) * height + (1 - canvas.origin[1] / canvas.size[1] - bottom) * imageHeight;
  return {
    scale: [2 * flip * canvas.pixelsPerUnit / canvas.size[0] * imageWidth / width,
      2 * canvas.pixelsPerUnit / canvas.size[1] * imageHeight / height],
    origin: [2 * x / width - 1, 1 - 2 * y / height],
    flipped: Boolean(actor.flip),
  };
}
