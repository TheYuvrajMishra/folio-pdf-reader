# Annotate integration (M4 mount contract)

Do NOT modify `ReaderScreen.tsx` in M4 — wire the pieces below in the
reader screen (or a new `AnnotateHost` it renders). `AnnotationStore` is
per-book: create one when the book opens, keep it for the session.

```tsx
const [annotateMode, setAnnotateMode] = useState(false);
const [tool, setTool] = useState<AnnotateTool>('highlight');
const [color, setColor] = useState(highlightPalette.yellow);
const [opacity, setOpacity] = useState(1);
const [penWidth, setPenWidth] = useState(3);
const [annots, setAnnots] = useState<Annotation[]>([]);
const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);
const store = useMemo(() => new AnnotationStore(bookId), [bookId]);
const refresh = useCallback(async () => {
  setAnnots(await store.listAnnotations(page));
  setCanUndo(await store.canUndo()); setCanRedo(await store.canRedo());
}, [store, page]);
const doUndo = useCallback(async () => {
  const affected = await store.undo();   // fade these 140ms (DESIGN §7)
  if (affected) await refresh();
}, [store, refresh]);
const annotateGestures = useAnnotateGestures({
  enabled: annotateMode, onUndo: doUndo, onRedo: doRedo,
});
const toScreen = useCallback(
  (r: NormRect) => toScreenFromPageRect(pageRectOnScreen)(r), [pageRectOnScreen]);

<GestureDetector gesture={annotateGestures}>   {/* 2-finger undo / 3-finger redo */}
  <Canvas style={...}>                          {/* reader's existing Canvas */}
    <PageBitmap ... />                           {/* existing page image */}
    {annotateMode && (                           {/* overlay ABOVE PageCanvas */}
      <AnnotationLayer annotations={annots} toScreen={toScreen}
                       fadeById={fadeById /* reanimated-driven 140ms */} />
    )}
  </Canvas>
</GestureDetector>
{annotateMode
  ? <AnnotateToolbar activeTool={tool} onToolChange={setTool}
      color={color} onColorChange={setColor}
      opacity={opacity} onOpacityChange={setOpacity}
      penWidth={penWidth} onPenWidthChange={setPenWidth}
      canUndo={canUndo} canRedo={canRedo} onUndo={doUndo} onRedo={doRedo} />
  : <ReaderChrome ... />}                        {/* toolbar swap */}
```

Selection long-press hook-in (DESIGN §8: long-press text = start selection):
in the reader's long-press handler, when `annotateMode` and tool is
highlight/underline/strike, convert the touch to normalized coords and call
`snapSelection(pageLines, anchor, current)`; on release, `store.addAnnotation`
with `dataJson: { rects }`. Pen strokes: collect touch points, then
`store.addAnnotation({ type: 'pen', dataJson: { polyline, width: penWidth } })`
— the store Douglas-Peucker-simplifies (ε=0.0005) at write time. Eraser:
`store.eraseAt(page, normPoint, eraserRadius / pageWidthPx)`. Undo/redo
return the affected annotations — drive `fadeById` and scroll the page to
the first affected annotation when it is off-screen (DESIGN §7).
