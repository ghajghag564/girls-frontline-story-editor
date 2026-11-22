const steps = [
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
      "选择一条旁白或点击「＋ 旁白」。",
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
      "用「下载工程」取得可以备份的工程文件。"
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
      "选分辨率、帧率与编码，然后填导出起止时间。",
      "点击「导出 MP4」，等待完成后打开视频。"
    ],
    "tip": "导出时保持编辑器页面打开。",
    "practice": "导出开头几秒并检查成片。"
  }
];

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

export function setupTutorial({api, actions, onError, onPause = () => {}, getProject, selectEntry}) {
  const $ = id => document.getElementById(id);
  const dialog = $('tutorial-dialog'), tip = $('start-tip'), originalTip = [...tip.childNodes];
  let index = 0, state = {seen: false, completed: false, step: 0};
  let saving = Promise.resolve(), target = null, coaching = false;
  const text = (tag, value) => Object.assign(document.createElement(tag), {textContent: value});
  const makeButton = (label, action) => Object.assign(text('button', label), {type: 'button', onclick: action});

  function remember() {
    state.seen = true;
    state.step = index;
    const snapshot = {...state};
    saving = saving.then(() => api('/tutorial', {method: 'POST', body: snapshot})).catch(onError);
    $('guide-resume').hidden = state.completed;
  }
  function clearPractice() {
    target?.classList.remove('tutorial-target');
    target = null;
    coaching = false;
    tip.classList.remove('tutorial-practice');
    tip.replaceChildren(...originalTip);
  }
  function focus(control) {
    if (!control || control.disabled) return;
    target = control;
    target.classList.add('tutorial-target');
    target.scrollIntoView({block: 'nearest', inline: 'nearest'});
    target.focus({preventScroll: true});
  }
  function showStep() {
    const step = steps[index];
    $('tutorial-progress').textContent = `第 ${index + 1} / ${steps.length} 步`;
    $('tutorial-title').textContent = step.title;
    $('tutorial-intro').textContent = step.intro;
    $('tutorial-list').replaceChildren(...step.tasks.map(task => text('li', task)));
    $('tutorial-tip').textContent = step.tip;
    tabs.forEach((button, i) => button.setAttribute('aria-current', i === index ? 'step' : 'false'));
    $('tutorial-prev').disabled = index === 0;
    $('tutorial-next').textContent = index === steps.length - 1 ? '完成教程' : '下一步';
    $('tutorial-action').textContent = step.button;
  }
  function open() {
    if (dialog.open) return;
    onPause();
    clearPractice();
    showStep();
    dialog.showModal();
  }
  function finish() {
    state.completed = true;
    clearPractice();
    if (dialog.open) dialog.close();
    else remember();
  }
  function next() {
    if (index === steps.length - 1) return finish();
    index++;
    if (dialog.open) showStep();
    else open();
  }
  function showPractice() {
    const step = steps[index], heading = text('strong', `练习 ${index + 1} / ${steps.length} · ${step.title}`);
    const instruction = text('span', step.practice);
    instruction.id = 'tutorial-practice-text';
    instruction.setAttribute('role', 'status');
    const navigation = document.createElement('div');
    navigation.append(makeButton('看步骤', open), makeButton(index === steps.length - 1 ? '完成教程' : '下一步', next),
      makeButton('收起', clearPractice));
    coaching = true;
    tip.classList.add('tutorial-practice');
    tip.replaceChildren(heading, instruction, navigation);
  }
  function feedback(message) {
    const output = $('tutorial-practice-text');
    if (coaching && output) output.textContent = message;
  }
  function locate(action) {
    const selected = document.querySelector('#scene-list .line-item.active')?.dataset.lineId;
    const shot = exerciseEntry(getProject?.(), action, selected);
    if (shot) selectEntry?.(shot.sceneId, shot.line.id);
    return shot;
  }
  async function practice() {
    const {action} = steps[index];
    state.completed = false;
    dialog.close();
    showPractice();
    if (action === 'example') return actions.example();
    if (action === 'export') return actions.export();
    if (action === 'save') return focus($('project-title'));
    const shot = locate(action);
    if (action === 'music') {
      if (shot) return $('choose-music').click();
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
      const cards = [...$('actors').querySelectorAll('.actor-control')];
      const choices = cards.map(c => ({id: c.dataset.instanceId, select: c.querySelector('select')}))
        .filter(c => c.select && !c.select.disabled && c.select.options.length > 1);
      const which = choices.find(c => c.id === preferred) ?? choices[0];
      if (which) focus(which.select);
      else feedback('当前造型只有默认姿态。先用「人物入场」选择带表情的造型，再打开其表情预览。');
    }
  }

  const tabs = steps.map((step, i) => makeButton(`${i + 1}. ${step.title}`, () => {
    index = i;
    showStep();
  }));
  $('tutorial-tabs').replaceChildren(...tabs);
  $('tutorial-prev').onclick = () => { index = Math.max(0, index - 1); showStep(); };
  $('tutorial-next').onclick = next;
  $('tutorial-later').onclick = () => dialog.close();
  $('tutorial-action').onclick = () => { practice().catch(onError); };
  dialog.addEventListener('close', remember);
  $('guide-resume').onclick = open;
  $('line-text').addEventListener('input', () => {
    if (steps[index].action === 'dialogue') feedback('正文已改动。点击「播放」，看台词逐字出现时口型如何跟随。');
  });
  return {
    open: () => {
      if (state.completed) { index = 0; state.completed = false; }
      open();
    },
    firstRun: async () => {
      state = await api('/tutorial');
      index = Math.max(0, Math.min(steps.length - 1, Number(state.step) || 0));
      $('guide-resume').hidden = state.completed;
      if (!state.seen) open();
    }
  };
}
