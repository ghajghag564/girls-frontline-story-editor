import {t} from './i18n.mjs';
const quickSteps = [
  {
    title: '打开练习工程', action: 'example', button: '打开练习工程',
    intro: '可以用配置的本地示例，也可以从一段纯色对白开始。打开后点「播放」看几秒。',
    practice: '点舞台下方的「播放」，看台词出现在画面上。',
  },
  {
    title: '改一句台词', action: 'dialogue', button: '去改台词',
    intro: '改一句对白，然后回放，看看你写的字怎样出现在舞台上。',
    practice: '把「正文」改成「准备好了，我们开始吧！」，再点「播放」回看。',
  },
  {
    title: '切换字幕样式', action: 'subtitle', button: '去选字幕样式',
    intro: '从游戏原版切到「小剧场模式」，试着改一个颜色。回到舞台后，对照两种样式的效果。',
    practice: '回到舞台看字幕。整部作品的预览和 MP4 都使用你选的样式。',
  },
  {
    title: '导出开头 3 秒', action: 'export', button: '去导出片段',
    intro: '导出面板会预填开头最多 3 秒。点「导出 MP4」，完成后点「下载已完成的视频」。',
    practice: '打开下载的 MP4，核对台词和字幕样式。',
  },
];

const detailedSteps = [
  {
    "title": "打开练习工程",
    "action": "example",
    "button": "建立练习副本",
    "intro": "配置本地示例后，可以从已有的剧本开始练习。",
    "tasks": [
      "点击下方按钮，建立可以独立保存的练习副本。",
      "用舞台下方的「播放」预览，或选择左侧的某一句再播放。"
    ],
    "tip": "没有本地示例时会新建空白练习。",
    "practice": "播放一小段，再从左侧选择你想编辑的条目。"
  },
  {
    "title": "编辑对白",
    "action": "dialogue",
    "button": "定位对白",
    "intro": "右侧面板可以单独编辑每句内容。",
    "tasks": [
      "在「正文」修改文字后回放，观察打字与口型。",
      "点「撤销」可以恢复刚改过的文字。"
    ],
    "tip": "停留时间和文字速度可以分别调节。",
    "practice": "修改一句对白，预览后试一次撤销。"
  },
  {
    "title": "切换发言人",
    "action": "speaker",
    "button": "定位发言",
    "intro": "发言人影响舞台高亮与显示姓名。",
    "tasks": [
      "选择一句有多个人物的对白，切换「当前发言人物」。",
      "多人齐声时可以选择多个在场人物。"
    ],
    "tip": "需要字幕但没有在场人物时，可选择「画外人物／无人高亮」。",
    "practice": "切换发言人物，观察亮度变化。"
  },
  {
    "title": "安排旁白和背景",
    "action": "narration",
    "button": "定位旁白",
    "intro": "旁白用于描述动作或补充说明。",
    "tasks": [
      "选择一条旁白，或从左侧「插入条目」选择「＋ 旁白」。",
      "更改右侧背景，查看下一句如何继承。"
    ],
    "tip": "「继承上句」会沿用前一句背景。",
    "practice": "切换背景，再比较随后条目的预览。"
  },
  {
    "title": "切换表情",
    "action": "expression",
    "button": "定位人物表情",
    "intro": "同一人物模型可以使用素材目录中的表情。",
    "tasks": [
      "在人物卡打开「查看表情预览」，选择一项表情。",
      "也可以用下拉框恢复模型默认姿态。"
    ],
    "tip": "如果模型没有配置表情，先选择另一套造型。",
    "practice": "选择一个表情，再与默认姿态比较。"
  },
  {
    "title": "安排退场和空镜",
    "action": "ending",
    "button": "预览片尾",
    "intro": "停顿可以让画面停留在最后一个背景上。",
    "tasks": [
      "在最后一段回放，查看人物退场与空镜。",
      "点击「＋ 停顿」，用人物卡的退场按钮移除人物。"
    ],
    "tip": "要让画面全黑，可添加「＋ 黑场」。",
    "practice": "回看片尾，检查画面停留时间。"
  },
  {
    "title": "试听背景音乐",
    "action": "music",
    "button": "打开音乐库",
    "intro": "可以在台词、旁白或停顿处开始播放音乐。",
    "tasks": [
      "打开音乐库，选一首本地曲目播放试听。",
      "为作品调整音量、循环和淡入淡出。"
    ],
    "tip": "作品音量用于导出，监听音量只影响预览。",
    "practice": "试听曲目，再设置当前条目的音乐。"
  },
  {
    "title": "命名并保存",
    "action": "save",
    "button": "编辑工程名",
    "intro": "保存后可从「打开」继续。",
    "tasks": [
      "输入一个容易辨认的名字，点击「保存」。",
      "要备份工程，可从顶栏「工程」菜单选择「下载工程」。"
    ],
    "tip": "「另存为」可以保留练习的不同版本。",
    "practice": "给工程命名并保存。"
  },
  {
    "title": "导出一段 MP4",
    "action": "export",
    "button": "打开导出设置",
    "intro": "选一小段先检查台词、画面和音乐。",
    "tasks": [
      "从舞台的「字幕样式」选定全片用的模式，再选分辨率、帧率、编码和导出时间。",
      "点击「导出 MP4」，完成后点「下载已完成的视频」。"
    ],
    "tip": "导出时保持编辑器页面打开。",
    "practice": "导出开头几秒并检查成片。"
  }
];

const guides = { quick: quickSteps, detail: detailedSteps };

function readProgress(value, steps) {
  return {
    seen: value?.seen === true,
    completed: value?.completed === true,
    step: Math.max(0, Math.min(steps.length - 1, Number.isInteger(value?.step) ? value.step : 0)),
  };
}

function exerciseEntry(project, action, selectedId) {
  let actors = [];
  const shots = [];
  for (const scene of project?.scenes ?? []) {
    for (const line of scene.entries) {
      actors = line.stage?.actors ?? actors;
      shots.push({sceneId:scene.id,line,actors});
    }
  }
  const selected = shots.find(shot => shot.line.id === selectedId);
  const pick = predicate => selected && predicate(selected) ? selected : shots.find(predicate);
  const dialogue = shot => shot.line.kind === 'dialogue';
  if (action === 'dialogue') return pick(dialogue);
  if (action === 'speaker') return pick(shot => dialogue(shot) && shot.actors.length > 1) ?? pick(dialogue);
  if (action === 'narration') return pick(shot => shot.line.kind === 'narration');
  if (action === 'expression') return pick(shot => shot.actors.length > 0);
  if (action === 'ending') return shots.findLast(shot => shot.actors.length > 0) ?? shots.at(-1);
  if (action === 'music') return pick(shot => shot.line.music?.op === 'play');
}

export function setupTutorial({api, actions, onError, onPause = () => {}, getProject, selectEntry, revealControl}) {
  const $ = id => document.getElementById(id);
  const dialog = $('tutorial-dialog'), tip = $('start-tip'), originalTip = [...tip.childNodes];
  const progress = {
    quick: { ...readProgress(undefined, quickSteps), projectId: null },
    detail: readProgress(undefined, detailedSteps),
  };
  let guide = 'quick', saving = Promise.resolve(), target = null, coaching = false, preparing = false;
  let practiceMessage = null;
  const text = (tag, value) => Object.assign(document.createElement(tag), {textContent: value});
  const makeButton = (label, action) => Object.assign(text('button', label), {type: 'button', onclick: action});
  const active = () => progress[guide];
  const currentStep = () => guides[guide][active().step];

  function resumableGuide() {
    return [guide, guide === 'quick' ? 'detail' : 'quick'].find(key => progress[key].seen && !progress[key].completed);
  }
  function updateResume() {
    $('guide-resume').hidden = !resumableGuide();
  }
  function remember() {
    active().seen = true;
    const body = { guide, ...active() };
    saving = saving.then(() => api('/tutorial', {method: 'POST', body})).catch(onError);
    updateResume();
  }
  function clearPractice() {
    target?.classList.remove('tutorial-target');
    target = null;
    coaching = false;
    practiceMessage = null;
    tip.classList.remove('tutorial-practice');
    tip.replaceChildren(...originalTip);
  }
  function focus(control) {
    if (!control || control.disabled) return;
    revealControl(control);
    target = control;
    target.classList.add('tutorial-target');
    target.scrollIntoView({block: 'nearest', inline: 'nearest'});
    target.focus({preventScroll: true});
  }
  function showStep() {
    const steps = guides[guide], index = active().step, step = currentStep();
    const quick = guide === 'quick';
    dialog.dataset.guide = guide;
    $('tutorial-progress').textContent = t(quick ? '快速上手 · 第 {0} / {1} 步' : '第 {0} / {1} 步', index + 1, steps.length);
    $('tutorial-title').textContent = t(step.title);
    $('tutorial-intro').textContent = t(step.intro);
    $('tutorial-list').replaceChildren(...(step.tasks ?? []).map(task => text('li', t(task))));
    $('tutorial-tip').textContent = t(step.tip ?? '');
    for (const id of ['tutorial-tabs', 'tutorial-list', 'tutorial-tip', 'tutorial-return-hint', 'tutorial-next']) $(id).hidden = quick;
    $('tutorial-footer').hidden = quick && index === 0;
    tabs.forEach((button, i) => button.setAttribute('aria-current', !quick && i === index ? 'step' : 'false'));
    $('tutorial-prev').disabled = index === 0;
    $('tutorial-next').textContent = index === steps.length - 1 ? t("完成教程") : t("下一步");
    $('tutorial-action').textContent = t(step.button);
  }
  function open(nextGuide = guide) {
    if (dialog.open || preparing) return;
    onPause();
    clearPractice();
    guide = nextGuide;
    if (active().completed) {
      active().step = 0;
      active().completed = false;
      if (guide === 'quick') active().projectId = null;
    }
    showStep();
    dialog.showModal();
    $('tutorial-action').focus();
  }
  function dismiss() {
    remember();
    dialog.close();
  }
  function finish() {
    active().completed = true;
    clearPractice();
    remember();
    if (dialog.open) dialog.close();
  }
  function next() {
    if (active().step === guides[guide].length - 1) return finish();
    active().step++;
    if (dialog.open) showStep();
    else {
      remember();
      open();
    }
  }
  function showPractice(message = currentStep().practice) {
    const step = currentStep();
    practiceMessage = message;
    const heading = text('strong', (guide === 'quick' ? t("快速上手 ") : t("练习 ")) + (active().step + 1) + ' / ' + guides[guide].length + ' · ' + t(step.title));
    const instruction = text('span', t(message));
    instruction.id = 'tutorial-practice-text';
    instruction.setAttribute('role', 'status');
    const navigation = document.createElement('div');
    const proceed = makeButton(active().step === guides[guide].length - 1 ? t("完成教程") : t("下一步"), next);
    if (guide === 'quick') proceed.classList.add('accent');
    navigation.append(makeButton(t("看步骤"), () => open()), proceed, makeButton(t("收起"), clearPractice));
    coaching = true;
    tip.classList.add('tutorial-practice');
    tip.replaceChildren(heading, instruction, navigation);
  }
  function feedback(message) {
    const output = $('tutorial-practice-text');
    if (coaching && output) {
      practiceMessage = message;
      output.textContent = t(message);
    }
  }
  function locate(action) {
    const selected = document.querySelector('#scene-list .line-item.active')?.dataset.lineId;
    const shot = exerciseEntry(getProject?.(), action, selected);
    if (shot) selectEntry?.(shot.sceneId, shot.line.id);
    return shot;
  }
  async function prepareQuickProject() {
    const track = progress.quick;
    preparing = true;
    try {
      if (track.projectId) await actions.resumeExample(track.projectId);
      else {
        track.projectId = await actions.quickExample();
        if (!track.projectId) throw new Error(t("未能建立练习副本，请再试一次。"));
        remember();
      }
    } catch (error) {
      if (error.status === 404 && track.projectId) {
        track.step = 0;
        track.projectId = null;
        remember();
        throw new Error(t("找不到上次的练习副本。点「继续教程」建立新的副本。"));
      }
      throw error;
    } finally {
      preparing = false;
    }
  }
  async function practice() {
    const {action} = currentStep();
    const quick = guide === 'quick';
    dismiss();
    if (quick) await prepareQuickProject();
    showPractice();
    if (action === 'example') return quick ? focus($('play')) : actions.example();
    if (action === 'subtitle') {
      actions.subtitle();
      return focus($('subtitle-mode'));
    }
    if (action === 'export') return quick ? actions.quickExport() : actions.export();
    if (action === 'save') return focus($('project-title'));
    const shot = locate(action);
    if (action === 'music') {
      if (shot) {
        const control = $('choose-music');
        revealControl(control);
        return control.click();
      }
      focus($('music-op'));
      feedback('当前工程尚未设置起播曲目。在音乐操作里选「播放／重新播放」，再进入曲库试听。');
      return;
    }
    if (!shot) {
      feedback('当前工程缺少这个练习使用的条目。可以打开第一步建立演示副本，或继续下一步。');
      return;
    }
    if (action === 'dialogue') return focus($('line-text'));
    if (action === 'speaker') return focus($('speaker-actor').closest('label').hidden ? $('chorus-enabled') : $('speaker-actor'));
    if (action === 'narration') return focus($('choose-background'));
    if (action === 'ending') return $('play').click();
    if (action === 'expression') {
      const preferred = shot.line.speakerInstanceId ?? shot.line.speakerInstanceIds?.[0];
      const choices = [...$('actors').querySelectorAll('.actor-control')].map(card => ({
        id: card.dataset.instanceId, button: card.querySelector('[data-expression-preview]'),
      })).filter(choice => choice.button);
      const which = choices.find(choice => choice.id === preferred) ?? choices[0];
      if (which) focus(which.button);
      else feedback('当前造型只有默认姿态。先用「人物入场」选择带表情的造型，再打开其表情预览。');
    }
  }

  const tabs = detailedSteps.map((step, i) => makeButton((i + 1) + ". " + t(step.title), () => {
    active().step = i;
    showStep();
  }));
  $('tutorial-tabs').replaceChildren(...tabs);
  $('tutorial-prev').onclick = () => { active().step = Math.max(0, active().step - 1); showStep(); };
  $('tutorial-next').onclick = next;
  $('tutorial-later').onclick = dismiss;
  $('tutorial-action').onclick = () => { practice().catch(onError); };
  dialog.addEventListener('cancel', remember);
  $('guide-quick').onclick = () => open('quick');
  $('guide').onclick = () => open('detail');
  $('guide-resume').onclick = () => { const nextGuide = resumableGuide(); if (nextGuide) open(nextGuide); };
  $('line-text').addEventListener('input', () => {
    if (currentStep().action === 'dialogue') feedback(guide === 'quick'
      ? '台词已改动。点击「播放」回看你的版本。'
      : '正文已改动。点击「播放」，看台词逐字出现时口型如何跟随。');
  });
  return {
    refreshLocale: () => {
      tabs.forEach((button, i) => { button.textContent = (i + 1) + '. ' + t(detailedSteps[i].title); });
      if (dialog.open) showStep();
      if (coaching) showPractice(practiceMessage);
    },
    firstRun: async () => {
      const state = await api('/tutorial');
      progress.detail = readProgress(state, detailedSteps);
      const savedQuick = state?.quick;
      progress.quick = { ...readProgress(savedQuick, quickSteps), projectId: savedQuick?.projectId ?? null };
      const savedGuide = state?.guide;
      guide = savedGuide === 'quick' || savedGuide === 'detail' ? savedGuide : (progress.detail.seen ? 'detail' : 'quick');
      updateResume();
      if (!progress.quick.seen && !progress.detail.seen) open('quick');
    },
  };
}
