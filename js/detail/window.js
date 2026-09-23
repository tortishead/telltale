/* ---------------- render: the details pane ---------------- */
/* A row is `[term, value]`, and `[term, value, attrs]` where the row is also
   something to pick: the attributes go on both halves, so a click anywhere
   along the row is the same click. */
const dl = (rows) => `<dl class="dl">${rows.filter(Boolean).map(([k,v,at]) =>
  `<dt${at ? ' ' + at : ''}>${k}</dt><dd${at ? ' ' + at : ''}>${v}</dd>`).join('')}</dl>`;
const r = (rc) => `[${rc.l},${rc.t}][${rc.r},${rc.b}] &nbsp;<span style="color:var(--dim)">${rectW(rc)}×${rectH(rc)}</span>`;
const yn = (v) => v === null ? '<span style="color:var(--dim)">unknown</span>' : v ? '<span class="yes">yes</span>' : '<span class="no">no</span>';
const winName = (s) => s ? esc(s.replace(/^\w+\{\S+\s+u\d+\s+/,'').replace(/\}$/,'')) : null;
const wh = (o) => o ? `${o.w} × ${o.h}` : null;
const none = '<span style="color:var(--dim)">none</span>';
const dim = (t) => `<span style="color:var(--dim)">${t}</span>`;
/* A value that is a thing you paste back into a shell — a property name, a
   fingerprint, a path — set the way a shell would print it. */
const mono = (s) => `<span style="font-family:var(--mono);font-size:11.5px">${esc(s)}</span>`;
/* "Pick a event" is what a noun-shaped hole in a sentence does to it, and the
   nouns come from the tools rather than from the sentence. */
const an = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/* A flag Telltale has the official text for gets a chip you can hover or tab to.
   Which text depends on where the flag came from, so a chip names its set as
   well as itself. The tables are consts declared further down; reading them
   through a function keeps this above them. */
const DOC_SETS = {
  wm: { docs: () => FLAG_DOCS, src: 'WindowManager.LayoutParams' },
  sf: { docs: () => SF_FLAG_DOCS, src: 'layer_state_t' },
  input: { docs: () => INPUT_CONFIG_DOCS, src: 'WindowInfo.InputConfig' },
};
const chip = (f, set) => DOC_SETS[set].docs()[f]
  ? `<span class="chip chip-doc" tabindex="0" data-flag="${esc(f)}" data-flagset="${set}">${esc(f)}</span>`
  : `<span class="chip">${esc(f)}</span>`;
const chips = (arr, set) => arr.length
  ? `<div class="chips">${arr.map(f => chip(f, set)).join('')}</div>` : none;
/* The package flags have no javadoc worth quoting — the names say it — so they
   are chips without the hover. */
const flatChips = (arr) => arr.length
  ? `<div class="chips">${arr.map(f => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : none;

function windowDisplayDetail(d){
  const drawn = d.nodes.filter(w => w.frame).length;

  const rot = d.rotation === null ? null
    : /^[0-3]$/.test(d.rotation) ? `${+d.rotation * 90}° <span style="color:var(--dim)">(ROTATION_${d.rotation})</span>`
    : esc(d.rotation);

  const out = [];
  out.push(`<section class="dgroup"><h3>Display</h3>${dl([
    ['size', `${d.size.w} × ${d.size.h} px${d.synthesised ? ' <span style="color:var(--dim)">(inferred)</span>' : ''}`],
    d.dpSize && ['size in dp', `${d.dpSize.w} × ${d.dpSize.h} dp <span style="color:var(--dim)">· sw${d.dpSize.sw}dp</span>`],
    d.dpi && ['density', `${d.dpi} dpi`],
    d.initSize && (d.initSize.w !== d.size.w || d.initSize.h !== d.size.h) && ['initial size', wh(d.initSize)],
    d.appSize && ['app area', `${wh(d.appSize)} px <span style="color:var(--dim)">(after bars)</span>`],
    d.sizeRange && ['app size range', `${d.sizeRange.minW}×${d.sizeRange.minH} — ${d.sizeRange.maxW}×${d.sizeRange.maxH}`],
    rot && ['rotation', rot],
    d.cutoutInsets && ['cutout insets', `${d.cutoutInsets.l}, ${d.cutoutInsets.t}, ${d.cutoutInsets.r}, ${d.cutoutInsets.b} <span style="color:var(--dim)">(l t r b)</span>`],
    d.orientation && ['orientation', esc(d.orientation)],
    d.uiMode && ['ui mode', esc(d.uiMode)],
    d.night && ['night mode', d.night === 'night' ? 'yes' : 'no'],
    ['organized', yn(d.organized)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Focus</h3>${dl([
    ['focused window', winName(d.focus) || none],
    ['focused app', winName(d.focusedApp) || none],
    ['ime target', winName(d.imeTarget) || none],
  ])}</section>`);

  if(d.insets.length){
    // These keys are far too long for the two-column grid, so they stack.
    out.push(`<section class="dgroup"><h3>Insets sources</h3>${d.insets.map(i => `
      <div class="ins">
        <span>${esc(i.type)}</span> <span class="ins-id">#${esc(i.id)}</span>
        <span class="ins-rect">${rectValid(i.rect)
          ? `[${i.rect.l},${i.rect.t}][${i.rect.r},${i.rect.b}] · ${rectW(i.rect)}×${rectH(i.rect)}${i.visible ? '' : ' · hidden'}`
          : `empty${i.visible ? '' : ' · hidden'}`}</span>
      </div>`).join('')}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Windows</h3>${dl([
    ['on this display', d.nodes.length],
    ['with a frame', `${drawn}${drawn < d.nodes.length ? dim(` (${d.nodes.length - drawn} without)`) : ''}`],
    ['visible', d.nodes.filter(w => w.visible).length],
  ])}</section>`);

  return out;
}

/* >>> flag docs, generated by tools/flag-docs.py — do not edit by hand
   Official text for the flag names dumpsys prints, lifted from the javadoc of
   WindowManager.LayoutParams in AOSP (FLAG_*, PRIVATE_FLAG_* and SYSTEM_FLAG_*).
   c = constant, v = value, d = doc, x = @deprecated note, h = 1 @hide / 2 @SystemApi.
   Names are the ones in the ViewDebug flag tables, so they cover several releases:
   a dump from an old build can carry a flag that no longer exists on main. */
const FLAG_DOCS = {
 "ALLOW_LOCK_WHILE_SCREEN_ON": {"c": "FLAG_ALLOW_LOCK_WHILE_SCREEN_ON", "d": "Window flag: as long as this window is visible to the user, allow the lock screen to activate while the screen is on. This can be used independently, or in combination with FLAG_KEEP_SCREEN_ON and/or FLAG_SHOW_WHEN_LOCKED", "v": "0x00000001"},
 "ALT_FOCUSABLE_IM": {"c": "FLAG_ALT_FOCUSABLE_IM", "d": "Window flag: when set, inverts the input method focusability of the window. The effect of setting this flag depends on whether FLAG_NOT_FOCUSABLE is set: If FLAG_NOT_FOCUSABLE is not set, i.e. when the window is focusable, setting this flag prevents this window from becoming the target of the input method. …", "v": "0x00020000"},
 "APPEARANCE_CONTROLLED": {"c": "PRIVATE_FLAG_APPEARANCE_CONTROLLED", "d": "Flag to indicate that the window is controlling the appearance of system bars. So we don't need to adjust it by reading its system UI flags for compatibility.", "h": 1, "v": "0x04000000"},
 "BEHAVIOR_CONTROLLED": {"c": "PRIVATE_FLAG_BEHAVIOR_CONTROLLED", "d": "Flag to indicate that the window is controlling the behavior of system bars. So we don't need to adjust it by reading its window flags or system UI flags for compatibility.", "h": 1, "v": "0x08000000"},
 "BLUR_BEHIND": {"c": "FLAG_BLUR_BEHIND", "d": "Window flag: enable blur behind for this window.", "v": "0x00000004"},
 "COLOR_SPACE_AGNOSTIC": {"c": "PRIVATE_FLAG_COLOR_SPACE_AGNOSTIC", "d": "Flag to indicate that the window is color space agnostic, and the color can be interpreted to any color space.", "h": 1, "v": "0x01000000"},
 "COMPATIBLE_WINDOW": {"c": "PRIVATE_FLAG_COMPATIBLE_WINDOW", "d": "Window flag: special flag to limit the size of the window to be original size ([320x480] x density). Used to create window for applications running under compatibility mode.", "h": 1, "v": "0x00000080"},
 "CONSUME_IME_INSETS": {"c": "PRIVATE_FLAG_CONSUME_IME_INSETS", "d": "Flag to indicate that the window consumes the insets of Type.ime. This makes windows below this window unable to receive visible IME insets.", "h": 1, "v": "0x02000000"},
 "DIM_BEHIND": {"c": "FLAG_DIM_BEHIND", "d": "Window flag: everything behind this window will be dimmed. Use dimAmount to control the amount of dim.", "v": "0x00000002"},
 "DISABLE_WALLPAPER_TOUCH_EVENTS": {"c": "PRIVATE_FLAG_DISABLE_WALLPAPER_TOUCH_EVENTS", "d": "Flag that prevents the wallpaper behind the current window from receiving touch events.", "h": 1, "v": "0x00000400"},
 "DISMISS_KEYGUARD": {"c": "FLAG_DISMISS_KEYGUARD", "d": "Window flag: when set the window will cause the keyguard to be dismissed, only if it is not a secure lock keyguard. …", "v": "0x00400000", "x": "Use FLAG_SHOW_WHEN_LOCKED or KeyguardManager.requestDismissKeyguard instead. Since keyguard was dismissed all the time as long as an activity with this flag on its window was focused, keyguard couldn't guard against unintentional touches on the screen, which isn't desired."},
 "DITHER": {"c": "FLAG_DITHER", "d": "Window flag: turn on dithering when compositing this window to the screen.", "v": "0x00001000", "x": "This flag is no longer used."},
 "DRAWS_SYSTEM_BAR_BACKGROUNDS": {"c": "FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS", "d": "Flag indicating that this Window is responsible for drawing the background for the system bars. If set, the system bars are drawn with a transparent background and the corresponding areas in this window are filled with the colors specified in Window.getStatusBarColor and Window.getNavigationBarColor.", "v": "0x80000000"},
 "EDGE_TO_EDGE_ENFORCED": {"c": "PRIVATE_FLAG_EDGE_TO_EDGE_ENFORCED", "d": "Flag to indicate that the window is forcibly to go edge-to-edge.", "h": 1, "v": "0x00000800"},
 "EXCLUDE_FROM_SCREEN_MAGNIFICATION": {"c": "PRIVATE_FLAG_EXCLUDE_FROM_SCREEN_MAGNIFICATION", "d": "Flag to indicate that this window will be excluded while computing the magnifiable region on the un-scaled screen coordinate, which could avoid the cutout on the magnification border. It should be used for unmagnifiable overlays. Note unlike PRIVATE_FLAG_NOT_MAGNIFIABLE, this flag doesn't affect the ability of magnification. …", "h": 1, "v": "0x00200000"},
 "FAKE_HARDWARE_ACCELERATED": {"c": "PRIVATE_FLAG_FAKE_HARDWARE_ACCELERATED", "d": "If the window has requested hardware acceleration, but this is not allowed in the process it is in, then still render it as if it is hardware accelerated. …", "h": 1, "v": "0x00000001"},
 "FIT_INSETS_CONTROLLED": {"c": "PRIVATE_FLAG_FIT_INSETS_CONTROLLED", "d": "Flag to indicate that the window is controlling how it fits window insets on its own. So we don't need to adjust its attributes for fitting window insets.", "h": 1, "v": "0x10000000"},
 "FLAG_LAYOUT_ATTACHED_IN_DECOR": {"c": "FLAG_LAYOUT_ATTACHED_IN_DECOR", "d": "Window flag: When requesting layout with an attached window, the attached window may overlap with the screen decorations of the parent window such as the navigation bar. By including this flag, the window manager will layout the attached window within the decor frame of the parent window such that it doesn't overlap with screen decorations.", "v": "0x40000000", "x": "Use setFitInsetsTypes to determine whether the attached window will overlap with system bars."},
 "FLAG_SLIPPERY": {"c": "FLAG_SLIPPERY", "d": "Window flag: Enable touches to slide out of a window into neighboring windows in mid-gesture instead of being captured for the duration of the gesture. This flag changes the behavior of touch focus for this window only. Touches can slide out of the window but they cannot necessarily slide back in (unless the other window with touch focus permits it).", "h": 1, "v": "0x20000000"},
 "FORCE_DECOR_VIEW_VISIBILITY": {"c": "PRIVATE_FLAG_FORCE_DECOR_VIEW_VISIBILITY", "d": "Flag that will make window ignore app visibility and instead depend purely on the decor view visibility for determining window visibility. This is used by recents to keep drawing after it launches an app.", "h": 1, "v": "0x00002000"},
 "FORCE_DRAW_STATUS_BAR_BACKGROUND": {"c": "PRIVATE_FLAG_FORCE_DRAW_BAR_BACKGROUNDS", "d": "Flag to indicate that this window is always drawing the status bar background, no matter what the other flags are.", "h": 1, "v": "0x00008000"},
 "FORCE_HARDWARE_ACCELERATED": {"c": "PRIVATE_FLAG_FORCE_HARDWARE_ACCELERATED", "d": "In the system process, we globally do not use hardware acceleration because there are many threads doing UI there and they conflict. If certain parts of the UI that really do want to use hardware acceleration, this flag can be set to force it. This is basically for the lock screen. Anyone else using it, you are probably wrong.", "h": 1, "v": "0x00000002"},
 "FORCE_NOT_FULLSCREEN": {"c": "FLAG_FORCE_NOT_FULLSCREEN", "d": "Window flag: override FLAG_FULLSCREEN and force the screen decorations (such as the status bar) to be shown.", "v": "0x00000800", "x": "This value became API \"by accident\", and shouldn't be used by 3rd party applications."},
 "FORCE_STATUS_BAR_VISIBLE": {"c": "PRIVATE_FLAG_FORCE_SHOW_STATUS_BAR", "d": "Flag to force the status bar window to be visible all the time. If the bar is hidden when this flag is set it will be shown again. This can only be set by LayoutParams.TYPE_STATUS_BAR.", "h": 1, "v": "0x00000800"},
 "FORCE_STATUS_BAR_VISIBLE_TRANSPARENT": {"c": "PRIVATE_FLAG_FORCE_STATUS_BAR_VISIBLE_TRANSPARENT", "d": "Flag to force the status bar window to be visible all the time. If the bar is hidden when this flag is set it will be shown again and the bar will have a transparent background. This can only be set by LayoutParams.TYPE_STATUS_BAR.", "h": 1, "v": "0x00001000"},
 "FULLSCREEN": {"c": "FLAG_FULLSCREEN", "d": "Window flag: hide all screen decorations (such as the status bar) while this window is displayed. This allows the window to use the entire display space for itself -- the status bar will be hidden when an app window with this flag set is on the top layer. A fullscreen window will ignore a value of SOFT_INPUT_ADJUST_RESIZE for the window's softInputMode field; the window will stay fullscreen and will not resize. …", "v": "0x00000400", "x": "Use WindowInsetsController.hide with Type.statusBars instead."},
 "HARDWARE_ACCELERATED": {"c": "FLAG_HARDWARE_ACCELERATED", "d": "Indicates whether this window should be hardware accelerated. Requesting hardware acceleration does not guarantee it will happen. This flag can be controlled programmatically only to enable hardware acceleration. To enable hardware acceleration for a given window programmatically, do the following: Window w = activity. …", "v": "0x01000000"},
 "HIDE_NON_SYSTEM_OVERLAY_WINDOWS": {"c": "SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS", "d": "Flag to indicate that any window added by an application process that is of type TYPE_TOAST or that requires AppOpsManager.OP_SYSTEM_ALERT_WINDOW permission should be hidden when this window is visible.", "h": 2, "v": "0x00080000"},
 "IGNORE_CHEEK_PRESSES": {"c": "FLAG_IGNORE_CHEEK_PRESSES", "d": "Window flag: intended for windows that will often be used when the user is holding the screen against their face, it will aggressively filter the event stream to prevent unintended presses in this situation that may not be desired for a particular window, when such an event stream is detected, the application will receive a CANCEL motion event to indicate this so applications can handle this accordingly by taking no action on the event until the finger is released.", "v": "0x00008000"},
 "IMMERSIVE_CONFIRMATION_WINDOW": {"c": "PRIVATE_FLAG_IMMERSIVE_CONFIRMATION_WINDOW", "d": "Flag to indicate that this window is a immersive mode confirmation window. The window should be ignored when calculating insets control. This is used for prompt window triggered by insets visibility changes. If it can take over the insets control, the visibility will change unexpectedly and the window may dismiss itself. Power button panic handling will be disabled when this window exists.", "h": 1, "v": "0x00020000"},
 "INHERIT_TRANSLUCENT_DECOR": {"c": "PRIVATE_FLAG_INHERIT_TRANSLUCENT_DECOR", "d": "Window flag: maintain the previous translucent decor state when this window becomes top-most.", "h": 1, "v": "0x00000200"},
 "INSET_PARENT_FRAME_BY_IME": {"c": "PRIVATE_FLAG_INSET_PARENT_FRAME_BY_IME", "d": "Flag to indicate that the parent frame of a window should be inset by IME.", "h": 1, "v": "0x40000000"},
 "INTERCEPT_GLOBAL_DRAG_AND_DROP": {"c": "PRIVATE_FLAG_INTERCEPT_GLOBAL_DRAG_AND_DROP", "d": "Flag to indicate that we want to intercept and handle global drag and drop for all users. This flag allows a window to considered for drag events even if not visible, and will receive drags for all active users in the system. Additional data is provided to windows with this flag, including the ClipData including all items with the DragEvent. …", "h": 1, "v": "0x80000000"},
 "IS_ROUNDED_CORNERS_OVERLAY": {"c": "PRIVATE_FLAG_IS_ROUNDED_CORNERS_OVERLAY", "d": "Indicates that this window is the rounded corners overlay present on some devices this means that it will be excluded from: screenshots, screen magnification, and mirroring.", "h": 1, "v": "0x00100000"},
 "IS_SCREEN_DECOR": {"c": "PRIVATE_FLAG_IS_SCREEN_DECOR", "d": "Flag to indicate that this window should be considered a screen decoration similar to the nav bar and status bar. This will cause this window to affect the window insets reported to other windows when it is visible.", "h": 1, "v": "0x00400000"},
 "KEEP_SCREEN_ON": {"c": "FLAG_KEEP_SCREEN_ON", "d": "Window flag: as long as this window is visible to the user, keep the device's screen turned on and bright.", "v": "0x00000080"},
 "KEYGUARD": {"c": "PRIVATE_FLAG_KEYGUARD", "d": "Flag whether the current window is a keyguard window, meaning that it will hide all other windows behind it except for windows with flag FLAG_SHOW_WHEN_LOCKED set. Further, this can only be set by LayoutParams.TYPE_STATUS_BAR.", "h": 1, "v": "0x00000400"},
 "LAYOUT_CHILD_WINDOW_IN_PARENT_FRAME": {"c": "PRIVATE_FLAG_LAYOUT_CHILD_WINDOW_IN_PARENT_FRAME", "d": "Flag to indicate that this child window should always be laid-out in the parent frame regardless of the current windowing mode configuration.", "h": 1, "v": "0x00004000"},
 "LAYOUT_INSET_DECOR": {"c": "FLAG_LAYOUT_INSET_DECOR", "d": "Window flag: a special option only for use in combination with FLAG_LAYOUT_IN_SCREEN. When requesting layout in the screen your window may appear on top of or behind screen decorations such as the status bar. By also including this flag, the window manager will report the inset rectangle needed to ensure your content is not covered by screen decorations. …", "v": "0x00010000", "x": "Insets will always be delivered to your application."},
 "LAYOUT_IN_SCREEN": {"c": "FLAG_LAYOUT_IN_SCREEN", "d": "Window flag for attached windows: Place the window within the entire screen, ignoring any constraints from the parent window. Note: on displays that have a DisplayCutout, the window may be placed such that it avoids the DisplayCutout area if necessary according to the layoutInDisplayCutoutMode.", "v": "0x00000100"},
 "LAYOUT_NO_LIMITS": {"c": "FLAG_LAYOUT_NO_LIMITS", "d": "Window flag: allow window to extend outside of the screen.", "v": "0x00000200"},
 "LAYOUT_SIZE_EXTENDED_BY_CUTOUT": {"c": "PRIVATE_FLAG_LAYOUT_SIZE_EXTENDED_BY_CUTOUT", "d": "Flag to indicate that the window frame should be the requested frame adding the display cutout frame. This will only be applied if a specific size smaller than the parent frame is given, and the window is covering the display cutout. The extended frame will not be larger than the parent frame.", "h": 1, "v": "0x00001000"},
 "LOCAL_FOCUS_MODE": {"c": "FLAG_LOCAL_FOCUS_MODE or FLAG_LAYOUT_IN_OVERSCAN", "d": "Ambiguous: WindowManager prints this one name for two flags, and the dump does not say which is set. FLAG_LOCAL_FOCUS_MODE (0x10000000) marks a window in local focus mode, which controls focus itself through Window.setLocalFocus instead of through the window manager. FLAG_LAYOUT_IN_OVERSCAN (0x02000000) let window contents extend into the display's overscan area, and is deprecated — no Android product has set an overscan area since Android 11.", "v": "0x10000000 / 0x02000000"},
 "NOT_FOCUSABLE": {"c": "FLAG_NOT_FOCUSABLE", "d": "Window flag: this window won't ever get key input focus, so the user can not send key or other button events to it. Those will instead go to whatever focusable window is behind it. This flag will also enable FLAG_NOT_TOUCH_MODAL whether or not that is explicitly set. …", "v": "0x00000008"},
 "NOT_MAGNIFIABLE": {"c": "PRIVATE_FLAG_NOT_MAGNIFIABLE", "d": "Flag to prevent the window from being magnified by the accessibility magnifier. TODO(b/190623172): This is a temporary solution and need to find out another way instead.", "h": 1, "v": "0x00400000"},
 "NOT_TOUCHABLE": {"c": "FLAG_NOT_TOUCHABLE", "d": "Window flag: this window can never receive touch events. The intention of this flag is to leave the touch to be handled by some window below this window (in Z order). Starting from Android VERSION_CODES.S, for security reasons, touch events that pass through windows containing this flag (ie. …", "v": "0x00000010"},
 "NOT_TOUCH_MODAL": {"c": "FLAG_NOT_TOUCH_MODAL", "d": "Window flag: even when this window is focusable (its FLAG_NOT_FOCUSABLE is not set), allow any pointer events outside of the window to be sent to the windows behind it. Otherwise it will consume all pointer events itself, regardless of whether they are inside of the window.", "v": "0x00000020"},
 "NO_MOVE_ANIMATION": {"c": "PRIVATE_FLAG_NO_MOVE_ANIMATION", "d": "Never animate position changes of the window.", "h": 1, "v": "0x00000040"},
 "OPTIMIZE_MEASURE": {"c": "PRIVATE_FLAG_OPTIMIZE_MEASURE", "d": "Flag to indicate that the view hierarchy of the window can only be measured when necessary. If a window size can be known by the LayoutParams, we can use the size to relayout window, and we don't have to measure the view hierarchy before laying out the views. This reduces the chances to perform measure.", "h": 1, "v": "0x00000200"},
 "OPTOUT_EDGE_TO_EDGE": {"c": "PRIVATE_FLAG_OPT_OUT_EDGE_TO_EDGE", "d": "Flag to indicate that the window has the Window_windowOptOutEdgeToEdgeEnforcement flag set.", "h": 1, "v": "0x04000000"},
 "OVERRIDE_LAYOUT_IN_DISPLAY_CUTOUT_MODE": {"c": "PRIVATE_FLAG_OVERRIDE_LAYOUT_IN_DISPLAY_CUTOUT_MODE", "d": "Flag to indicate that the window is forcibly to layout under the display cutout.", "h": 1, "v": "0x00040000"},
 "PRESERVE_GEOMETRY": {"c": "PRIVATE_FLAG_PRESERVE_GEOMETRY", "d": "Flag indicating that the x, y, width, and height members should be ignored (and thus their previous value preserved). For example because they are being managed externally through repositionChild.", "h": 1, "v": "0x00002000"},
 "PRIVATE_FLAG_SYSTEM_APPLICATION_OVERLAY": {"c": "PRIVATE_FLAG_SYSTEM_APPLICATION_OVERLAY", "d": "When set LayoutParams.TYPE_APPLICATION_OVERLAY windows will stay visible, even if LayoutParams.SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS is set for another visible window.", "h": 1, "v": "0x00000008"},
 "SCALED": {"c": "FLAG_SCALED", "d": "Window flag: a special mode where the layout parameters are used to perform scaling of the surface when it is composited to the screen.", "v": "0x00004000"},
 "SECURE": {"c": "FLAG_SECURE", "d": "Window flag: treat the content of the window as secure, preventing it from appearing in screenshots or from being viewed on non-secure displays. See View.setContentSensitivity, a window hosting a sensitive view will be marked as secure during media projection, preventing it from being viewed on non-secure displays and during screen share. …", "v": "0x00002000"},
 "SHOW_FOR_ALL_USERS": {"c": "SYSTEM_FLAG_SHOW_FOR_ALL_USERS", "d": "In a multiuser system if this flag is set and the owner is a system process then this window will appear on all user screens. This overrides the default behavior of window types that normally only appear on the owning user's screen. Refer to each window type to determine its default behavior.", "h": 2, "v": "0x00000010"},
 "SHOW_WALLPAPER": {"c": "FLAG_SHOW_WALLPAPER", "d": "Window flag: ask that the system wallpaper be shown behind your window. The window surface must be translucent to be able to actually see the wallpaper behind it; this flag just ensures that the wallpaper surface will be there if this window actually has translucent regions. This flag can be controlled in your theme through the attr. …", "v": "0x00100000"},
 "SHOW_WHEN_LOCKED": {"c": "FLAG_SHOW_WHEN_LOCKED", "d": "Window flag: special flag to let windows be shown when the screen is locked. This will let application windows take precedence over key guard or any other lock screens. Can be used with FLAG_KEEP_SCREEN_ON to turn screen on and display windows directly before showing the key guard window. …", "v": "0x00080000", "x": "Use attr.showWhenLocked or Activity.setShowWhenLocked instead to prevent an unintentional double life-cycle event."},
 "SPLIT_TOUCH": {"c": "FLAG_SPLIT_TOUCH", "d": "Window flag: when set the window will accept for touch events outside of its bounds to be sent to other windows that also support split touch. When this flag is not set, the first pointer that goes down determines the window to which all subsequent touches go until all pointers go up. …", "v": "0x00800000"},
 "STATUS_FORCE_SHOW_NAVIGATION": {"c": "PRIVATE_FLAG_STATUS_FORCE_SHOW_NAVIGATION", "d": "Flag to indicate that the status bar window is in a state such that it forces showing the navigation bar unless the navigation bar window is explicitly set to View.GONE. It only takes effects if this is set by LayoutParams.TYPE_STATUS_BAR.", "h": 1, "v": "0x00800000"},
 "SUSTAINED_PERFORMANCE_MODE": {"c": "PRIVATE_FLAG_SUSTAINED_PERFORMANCE_MODE", "d": "Flag to indicate that this window needs Sustained Performance Mode if the device supports it.", "h": 1, "v": "0x00010000"},
 "SYSTEM_APPLICATION_OVERLAY": {"c": "PRIVATE_FLAG_SYSTEM_APPLICATION_OVERLAY", "d": "When set LayoutParams.TYPE_APPLICATION_OVERLAY windows will stay visible, even if LayoutParams.SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS is set for another visible window.", "h": 1, "v": "0x00000008"},
 "SYSTEM_ERROR": {"c": "PRIVATE_FLAG_SYSTEM_ERROR", "d": "Window flag: a special option intended for system dialogs. When this flag is set, the window will demand focus unconditionally when it is created.", "h": 1, "v": "0x00000100"},
 "TOUCHABLE_WHEN_WAKING": {"c": "FLAG_TOUCHABLE_WHEN_WAKING", "d": "Window flag: when set, if the device is asleep when the touch screen is pressed, you will receive this first touch event. Usually the first touch event is consumed by the system since the user can not see what they are pressing on.", "v": "0x00000040", "x": "This flag has no effect."},
 "TRANSLUCENT_NAVIGATION": {"c": "FLAG_TRANSLUCENT_NAVIGATION", "d": "Window flag: request a translucent navigation bar with minimal system-provided background protection. This flag can be controlled in your theme through the attr.windowTranslucentNavigation attribute; this attribute is automatically set for you in the standard translucent decor themes such as style. …", "v": "0x08000000", "x": "Use Window.setNavigationBarColor with a half-translucent color instead."},
 "TRANSLUCENT_STATUS": {"c": "FLAG_TRANSLUCENT_STATUS", "d": "Window flag: request a translucent status bar with minimal system-provided background protection. This flag can be controlled in your theme through the attr.windowTranslucentStatus attribute; this attribute is automatically set for you in the standard translucent decor themes such as style. …", "v": "0x04000000", "x": "Use Window.setStatusBarColor with a half-translucent color instead."},
 "TRUSTED_OVERLAY": {"c": "PRIVATE_FLAG_TRUSTED_OVERLAY", "d": "Flag to indicate that the window is a trusted overlay.", "h": 1, "v": "0x20000000"},
 "TURN_SCREEN_ON": {"c": "FLAG_TURN_SCREEN_ON", "d": "Window flag: when set as a window is being added or made visible, once the window has been shown then the system will poke the power manager's user activity (as if the user had woken up the device) to turn the screen on.", "v": "0x00200000", "x": "Use attr.turnScreenOn or Activity.setTurnScreenOn instead to prevent an unintentional double life-cycle event."},
 "UNRESTRICTED_GESTURE_EXCLUSION": {"c": "PRIVATE_FLAG_UNRESTRICTED_GESTURE_EXCLUSION", "d": "Flag to allow this window to have unrestricted gesture exclusion.", "h": 1, "v": "0x00000020"},
 "USE_BLAST": {"c": "PRIVATE_FLAG_USE_BLAST", "d": "Flag to request creation of a BLAST (Buffer as LayerState) Layer. If not specified the client will receive a BufferQueue layer.", "h": 1, "v": "0x02000000"},
 "WANTS_OFFSET_NOTIFICATIONS": {"c": "PRIVATE_FLAG_WANTS_OFFSET_NOTIFICATIONS", "d": "By default, wallpapers are sent new offsets when the wallpaper is scrolled. Wallpapers may elect to skip these notifications if they are not doing anything productive with them (they do not affect the wallpaper scrolling operation) by calling Engine.setOffsetNotificationsEnabled.", "h": 1, "v": "0x00000004"},
 "WATCH_OUTSIDE_TOUCH": {"c": "FLAG_WATCH_OUTSIDE_TOUCH", "d": "Window flag: if you have set FLAG_NOT_TOUCH_MODAL, you can set this flag to receive a single special MotionEvent with the action MotionEvent.ACTION_OUTSIDE for touches that occur outside of your window. Note that you will not receive the full down/move/up gesture, only the location of the first down as an ACTION_OUTSIDE.", "v": "0x00040000"},
 "WILL_NOT_REPLACE_ON_RELAUNCH": {"c": "PRIVATE_FLAG_WILL_NOT_REPLACE_ON_RELAUNCH", "d": "Flag to indicate that this window is not expected to be replaced across configuration change triggered activity relaunches. In general the WindowManager expects Windows to be replaced after relaunch, and thus it will preserve their surfaces until the replacement is ready to show in order to prevent visual glitch. …", "h": 1, "v": "0x00008000"},
};
/* <<< end flag docs */

function windowDetail(w){
  const out = [];
  out.push(`<section class="dgroup"><h3>Identity</h3>${dl([
    ['dump #', w.index],
    ['hash', esc(w.hash)],
    w.pkg && ['package', esc(w.pkg)],
    w.user && ['user', esc(w.user)],
    w.ownerUid !== null && ['owner uid', w.ownerUid],
    ['display', w.displayId],
    w.rootTaskId !== null && ['root task', w.rootTaskId],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Geometry</h3>${dl([
    w.frame && [`frame <span style="color:var(--dim)">(${esc(w.frameSource)})</span>`, r(w.frame)],
    w.requested && ['requested', `${w.requested.w}×${w.requested.h}`],
    ...Object.entries(w.rects)
      .filter(([k]) => k !== w.frameSource)
      .map(([k,rc]) => [esc(k), r(rc)]),
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Stacking</h3>${dl([
    ['z order', `${w.zRank+1} of ${w.zCount} <span style="color:var(--dim)">(1 = topmost)</span>`],
    ['base layer', w.baseLayer ?? '—'],
    ['sub layer', w.subLayer ?? '—'],
    w.token && ['token', esc(w.token)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>State</h3>${dl([
    ['visible', yn(w.visible)],
    ['on screen', yn(w.onScreen)],
    ['has surface', yn(w.hasSurface)],
    ['obscured', yn(w.obscured)],
    ['focused', yn(w.focused)],
    ['exiting', yn(w.exiting)],
    w.viewVisibility && ['view visibility', esc(w.viewVisibility) + (w.viewVisibility==='0x0' ? ' (VISIBLE)' : w.viewVisibility==='0x4' ? ' (INVISIBLE)' : w.viewVisibility==='0x8' ? ' (GONE)' : '')],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Attributes</h3>${dl([
    ['type', `<span style="color:${tintFor(w)}">■</span> ${esc(w.typeLabel)}`],
    w.format && ['format', esc(w.format)],
    w.gravity && ['gravity', esc(w.gravity)],
    ['flags', chips(w.flags, 'wm')],
    w.privFlags.length && ['private flags', chips(w.privFlags, 'wm')],
  ])}</section>`);

  return out;
}
