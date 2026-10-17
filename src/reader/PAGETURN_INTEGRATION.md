# PageTurn integration contract (M2 → coordinator)

`ReaderScreen.tsx` is untouched by M2. Apply the snippet below around its
existing page state (`page`, `pageRef`, `goToPage`, gesture tree).

```tsx
// 1. Settings (once, e.g. in the session effect):
const [animStyle, setAnimStyle] = useState<PageAnimationStyle>('curl');
useEffect(() => { void getSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'curl').then(setAnimStyle); }, []);
const reducedMotion = useReducedMotion(); // OS "remove animations" or in-app toggle

// 2. Turn state machine (replaces the M1 pan-swipe + 180ms fade logic):
const turn = usePageTurn({
  pageWidth: vw, style: animStyle, reducedMotion,
  onCommit: (dir) => {                       // progress hit 1
    const t = pageRef.current + dir;
    if (t < 1 || t > pageCountRef.current) { turn.cancelTurn(); return; }
    goToPage(t);                             // advances index…
    turn.progress.value = 0;                 // …then reset (static canvas shows new page)
  },
  onCancel: () => undefined,                 // progress already back at 0
  recordFrameTime: (ms) => frameLog.push(ms),// optional telemetry
  onDowngrade: () => { setAnimStyle('slide'); toast('Page animation simplified for smoothness'); },
});

// 3. Rasters (prefetch ±2 already covers these):
const frontImage = useImage(render ? `file://${render.path}` : null);
const backImage = useImage(nextPath ? `file://${nextPath}` : null);

// 4. Overlay above the static PageCanvas (stays mounted; invisible at rest):
<PageTurnView frontImage={frontImage} backImage={backImage} progress={turn.progress}
  direction={turn.direction} style={animStyle} pageSize={{ w: pageW, h: pageH }}
  reducedMotion={reducedMotion} />
// 5. Gestures: compose turn.gesture with pinch; tap zones call turn.runAnimatedTurn(±1):
const composed = Gesture.Simultaneous(pinch, turn.gesture, Gesture.Exclusive(doubleTap, tap));
// Delete the old pan swipe code + PAGE_FADE_MS fade in goToPage (turn overlay owns it now).
```

Notes for the coordinator (M3/M4):
- `backImage` should be the raster of `page + direction` (prefetch it before
  `runAnimatedTurn` for tap turns; during drags the ±2 prefetch usually has it).
  If it is null the curl reveals black — never start a visible turn without it.
- `turning` is true during drag + settle: gate ruler/annotate gestures on it.
- `direction` is latched from the drag; `downgraded` flips on auto-downgrade.
- `PageTurnView` is pointer-transparent and invisible at rest; it can stay
  mounted unconditionally.
```

Deviations from the task spec (all compatible extensions):
- `PageTurnApi` gains `downgraded: SharedValue<boolean>` (the task's "return
  downgraded=true" channel) and `UsePageTurnOpts` gains optional
  `onDowngrade()` (JS-thread toast hook). `recordFrameTime` stays exactly as
  specified: the hook measures UI-thread frame times itself and reports each
  sample through it.
