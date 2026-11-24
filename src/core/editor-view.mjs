export const defaultEditorView = Object.freeze({theme:'graphite',previewResolution:1080});

export const isEditorTheme = value => value==='graphite'||value==='light';
export const isPreviewResolution = value => [720,1080,1440,2160].includes(value);

export function readEditorView(value) {
 const {theme,previewResolution}=value??{};
 return {
  theme:isEditorTheme(theme)?theme:defaultEditorView.theme,
  previewResolution:isPreviewResolution(previewResolution)?previewResolution:defaultEditorView.previewResolution,
 };
}
