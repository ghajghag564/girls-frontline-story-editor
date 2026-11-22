function catalogList(rows, label) {
  if (!Array.isArray(rows)) throw new Error(label + '目录必须是数组');
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)
        || typeof row.name !== 'string' || ids.has(row.id)) {
      throw new Error(label + '目录有无效或重复的素材编号');
    }
    ids.add(row.id);
  }
  return rows;
}

const fields = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));

export function normalizeCatalog(data) {
  if (typeof data?.version !== 'string' || !data.version || data.version.length > 100) {
    throw new Error('本地素材目录缺少有效版本');
  }
  const backgrounds = catalogList(data.backgrounds, '背景').map(row =>
    fields(row, ['id','name','path','thumbnail','sha256','width','height']));
  const music = catalogList(data.music, '音乐').map(row => ({
    ...fields(row, ['id','name','path','sha256','sampleRate','channels','samples','duration']),
    loop:row.loop && fields(row.loop, ['start','end']),
  }));
  const characters = catalogList(data.characters, '人物').map(row => {
    if (!Array.isArray(row.textures) || !row.textures.length || new Set(row.textures.map(t => t.index)).size !== row.textures.length) {
      throw new Error('人物贴图目录无效：' + row.id);
    }
    return {
      ...fields(row, ['id','name','styleName','aliases','legacySpeakerName','modelPath','sha256','thumbnail']),
      framing:row.framing && fields(row.framing, ['bounds']),
      eyeBlink:row.eyeBlink && fields(row.eyeBlink, ['enabled','mean','parameterIds']),
      defaultPlacement:row.defaultPlacement && fields(row.defaultPlacement, ['x','y','scale']),
      expressionsComplete:row.expressionsComplete ?? true,
      textures:row.textures.map(t => fields(t, ['index','path','sha256','width','height'])),
      parameters:(row.parameters ?? []).map(spec => fields(spec, ['id','min','max','default'])),
      expressions:(row.expressions ?? []).map(expression => ({
        ...fields(expression, ['id','name','fadeIn','fadeOut']),
        parameters:(expression.parameters ?? []).map(spec => fields(spec, ['id','value','blend'])),
      })),
    };
  });
  return {version:data.version, backgrounds, characters, music};
}

export async function loadCatalog(assetIntegrity) {
  const {bytes, release} = await assetIntegrity.read('assets/catalog.json');
  try {
    const catalog = normalizeCatalog(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
    const matchingHash = (relative, extension, expected) => {
      const record = typeof relative === 'string' && relative.toLowerCase().endsWith(extension) &&
        assetIntegrity.hashes.get('assets/' + relative);
      if (!record || (expected && record.sha256 !== expected)) {
        throw new Error('素材目录与校验清单不符 ' + relative);
      }
      return record.sha256;
    };
    for (const item of catalog.backgrounds) {
      item.sha256 = matchingHash(item.path, '.png', item.sha256);
      if (item.thumbnail) matchingHash(item.thumbnail, '.png');
    }
    for (const item of catalog.music) item.sha256 = matchingHash(item.path, '.flac', item.sha256);
    for (const item of catalog.characters) {
      item.sha256 = matchingHash(item.modelPath, '.moc3', item.sha256);
      if (item.thumbnail) matchingHash(item.thumbnail, '.png');
      for (const texture of item.textures) texture.sha256 = matchingHash(texture.path, '.png', texture.sha256);
    }
    return catalog;
  } finally {
    release();
  }
}

export function publicCatalog(catalog) {
  const display = ({path, thumbnail, ...rest}) => rest;
  const characters = catalog.characters.map(({modelPath, thumbnail, textures, ...character}) => ({
    ...character,
    textures:textures.map(display),
  }));
  return {...catalog, backgrounds:catalog.backgrounds.map(display), music:catalog.music.map(display), characters};
}
