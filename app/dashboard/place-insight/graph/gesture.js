// 그래프 무대의 손짓(마우스·터치·펜)을 한곳에서 판정합니다. React 와 떨어져 있어 따로 시험할 수 있습니다.
//
// 무엇을 눌렀는지에 따라 갈립니다.
//   이름표 글자        → 누르면 그 점을 고름(사람은 점보다 글자를 누릅니다). 끌면 회전.
//   점(원판 + 4px)     → 누르면 고름. 끌면 '끌어당기기'(이어진 점들이 함께 당겨짐). 회전으로 넘어가지 않습니다.
//   밝혀진 연결(마우스) → 끌면 '줄 튕기기'
//   그 밖(빈 곳)       → 끌면 '회전'
// 누를 때 손이 조금 미끄러져도 누름으로 칩니다: 문턱(마우스 8px·터치 12px) 안이거나, 0.3초 안에 떼고 12px 미만이면 누름.
//
// 터치는 폰에서 그래프에 갇히지 않게 합니다: 세로 쓸기 = 페이지 스크롤, 가로 끌기 = 회전(캔버스는 touch-action: pan-y).
//   끌어당기기는 (1) 고른 점에 뜨는 손잡이(PlaceGraph 의 DOM 요소, touch-action: none)에서 시작하거나
//   (2) 이름이 떠 있는 점·묶음을 0.38초 길게 눌렀을 때만 시작합니다. 그 전에 8px 넘게 움직이면 평소대로(스크롤·회전).

const TAP_MS = 300;
const TAP_SLOP = 12;
const SLOP = { mouse: 8, pen: 8, touch: 12 };
const HOLD_MS = 380;
const HOLD_SHOW = 120;
const HOLD_SLOP = 8;
const HOLD_TAP = 10;

// canvas: 그래프 캔버스, E: 엔진
// on: { live(), loading(), hover(id|null), tap(node, { touch, named }), emptyTap(), pull({ phase: 'start'|'move'|'end', id, node, x, y, touch, pinned, cancelled }) }
// 돌려주는 값: { detach(), pullFrom(event, id, el), cancel() }
export function attachGestures(canvas, E, on) {
    const S = {
        pointers: new Map(),
        kind: 'idle', // idle · pending(눌렀고 아직 판정 전) · rotate · pull · pluck
        pid: -1, x0: 0, y0: 0, x: 0, y: 0, t: 0, t0: 0, far: 0,
        touch: false, type: 'mouse', node: null, grab: false, label: false, line: null,
        show: 0, timer: 0, held: false, moved: false, pinch: 0, hover: null,
        via: null, gx: 0, gy: 0, pullFar: 0, lock: false,
    };

    const local = (event) => {
        const rect = canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height];
    };
    const wake = () => E.invalidate?.();
    const setHover = (id) => {
        if (id === S.hover) return;
        S.hover = id;
        on.hover(id);
    };
    const pullable = (p) => Boolean(p) && on.live() && !p.ghost;

    // 포인터 아래에 무엇이 있는지. 순서: 이름표 글자 → 점 원판(+4px) → 밝혀진 연결(마우스) → 가까운 점
    function under(x, y, touch) {
        const none = { node: null, grab: false, label: false, line: null };
        if (on.loading()) return none;
        // 손가락은 따로 판정합니다(이름이 꺼진 점은 원판 + 6px 안일 때만 — E.pickTouch).
        const p = touch ? E.pickTouch(x, y) : E.pick(x, y, 11);
        // 마우스 포인터가 점의 원판 안에 있으면 그 점이 먼저입니다. 다른 점의 이름표가 그 위에 걸쳐 있어도, 점을 잡고 끄는 것이 회전으로 바뀌지 않게.
        // 손가락은 이름표가 먼저입니다(톡 해서 띄운 이름표는 점들 위에 놓이므로, 그 이름표를 누를 때 밑에 깔린 점이 잡히면 안 됩니다).
        const inside = !touch && Boolean(p) && Math.hypot(x - p.sx, y - p.sy) <= p.rr;
        let named = inside ? null : E.pickLabel(x, y, touch ? 6 : 2);
        // 손가락이 점의 원판 위에 있고 이름표는 상자 둘레의 여유(6px)로만 걸린 경우에는 점이 먼저입니다
        // (이름표 바로 옆의 이름 꺼진 점을 톡 했는데 그 이름표의 카드가 열리지 않게).
        if (touch && named && p && named !== p && Math.hypot(x - p.sx, y - p.sy) <= p.rr + 1 && !E.pickLabel(x, y, 0)) named = null;
        if (named) return { node: named, grab: false, label: true, line: null };
        const onDisc = Boolean(p) && Math.hypot(x - p.sx, y - p.sy) <= p.rr + 4;
        if (onDisc) return { node: p, grab: pullable(p), label: false, line: null };
        const line = !touch && on.live() ? E.pickLink(x, y, 8) : null;
        if (line) return { node: null, grab: false, label: false, line };
        return { node: p, grab: false, label: false, line: null };
    }

    const onSelect = (event) => event.preventDefault();
    const onKey = (event) => {
        // Esc: 끌어당기던 것을 놓고 제자리로(카드는 닫지 않습니다)
        if (event.key !== 'Escape' || (S.kind !== 'pull' && S.kind !== 'pluck')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
    };

    function listen(active) {
        // 끄는 동안 페이지 글자가 선택되지 않게 하고, Esc 로 취소할 수 있게 합니다.
        if (active) {
            document.addEventListener('selectstart', onSelect);
            window.addEventListener('keydown', onKey, true);
        } else {
            document.removeEventListener('selectstart', onSelect);
            window.removeEventListener('keydown', onKey, true);
        }
    }

    function beginPull(p, x, y) {
        if (!pullable(p) || !E.pullStart(p.id, x, y, { touch: S.touch })) return false;
        S.kind = 'pull';
        S.gx = x;
        S.gy = y;
        S.pullFar = 0;
        setHover(p.id);
        (S.via || canvas).style.cursor = 'grabbing';
        canvas.style.cursor = 'grabbing';
        listen(true);
        on.pull?.({ phase: 'start', id: p.id, node: p.node, x, y, touch: S.touch });
        wake();
        return true;
    }

    function beginOther() {
        if (!S.touch && S.line && on.live() && E.pluckStart(S.line, S.x, S.y)) {
            S.kind = 'pluck';
            listen(true);
        } else {
            S.kind = 'rotate';
            S.line = null;
            E.dragStart();
            setHover(null);
        }
        canvas.style.cursor = 'grabbing';
        wake();
    }

    function clearHold() {
        clearTimeout(S.show);
        clearTimeout(S.timer);
        S.show = 0;
        S.timer = 0;
        E.setCharge(null);
    }

    // 길게 누르기(보조 경로): 이름이 떠 있는 점·묶음 중심만, 손가락이 그 점 16px 안이거나 이름표 위일 때만.
    function armHold(hit, x, y) {
        const p = hit.node;
        if (!pullable(p)) return;
        const near = hit.label || (Math.hypot(x - p.sx, y - p.sy) <= 16 && (p.lab.on || p.level <= 1));
        if (!near) return;
        S.show = setTimeout(() => {
            S.show = 0;
            if (S.kind === 'pending') {
                E.setCharge(p.id, HOLD_MS - HOLD_SHOW);
                wake();
            }
        }, HOLD_SHOW);
        S.timer = setTimeout(() => {
            S.timer = 0;
            E.setCharge(null);
            if (S.kind !== 'pending') return;
            if (beginPull(p, S.x, S.y)) {
                S.held = true;
                try {
                    navigator.vibrate?.(8);
                } catch (error) {
                    // 진동을 막아 둔 기기에서는 그냥 넘어갑니다.
                }
            }
        }, HOLD_MS);
    }

    function onDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        S.pointers.set(event.pointerId, [event.clientX, event.clientY]);
        canvas.setPointerCapture?.(event.pointerId);
        const touch = event.pointerType === 'touch';
        if (touch) E.pointerOn = true;
        if (S.pointers.size === 2) {
            // 두 번째 손가락: 하던 끌기는 그만두고 벌리기·오므리기(확대)로 넘어갑니다.
            cancel();
            const [a, b] = [...S.pointers.values()];
            S.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
            return;
        }
        if (S.pointers.size > 2) return;
        const [x, y] = local(event);
        const hit = under(x, y, touch);
        const now = performance.now();
        // 누른 것이 이름이 떠 있는 것(이름표·묶음·매장·이름이 켜진 점)인지 적어 둡니다. 손가락으로 이름 없는 점을 누르면 카드 대신 이름부터 띄웁니다.
        S.named = hit.label || Boolean(hit.node && (hit.node.level <= 1 || (hit.node.lab.on && hit.node.lab.a > 0.5)));
        Object.assign(S, {
            kind: 'pending', pid: event.pointerId, via: null, x0: x, y0: y, x, y, t: now, t0: now, far: 0,
            touch, type: event.pointerType || 'mouse', node: hit.node, grab: hit.grab, label: hit.label, line: hit.line, held: false, moved: false,
        });
        if (touch) armHold(hit, x, y);
        wake();
    }

    function onMove(event) {
        if (S.pointers.has(event.pointerId)) S.pointers.set(event.pointerId, [event.clientX, event.clientY]);
        if (S.pointers.size === 2 && S.pinch) {
            const [a, b] = [...S.pointers.values()];
            const spread = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (spread > 0) E.zoomBy(spread / S.pinch);
            S.pinch = spread;
            wake();
            return;
        }
        const [x, y, w, h] = local(event);
        if (S.kind === 'idle' || event.pointerId !== S.pid) {
            // 누르지 않은 채 움직임(마우스): 가리킨 점을 알리고, 무엇을 할 수 있는지 커서로 보입니다.
            if (event.pointerType === 'touch' || S.kind !== 'idle' || event.currentTarget !== canvas) return;
            const hit = under(x, y, false);
            canvas.style.cursor = hit.grab || hit.line ? 'grab' : hit.node ? 'pointer' : '';
            // 밝혀진 연결 위에서는 올려 둔 점을 그대로 둡니다(선을 따라 가운데로 가는 동안 연결이 꺼지지 않게).
            if (hit.node) setHover(hit.node.id);
            else if (!hit.line) setHover(null);
            return;
        }
        const far = Math.hypot(x - S.x0, y - S.y0);
        if (far > S.far) S.far = far;
        if (S.kind === 'pending') {
            // 길게 누르기 전에 움직였습니다 → 잡기를 그만두고 평소대로(세로는 브라우저가 스크롤로 가져가고, 가로는 회전).
            if (S.touch && (S.timer || S.show) && far > HOLD_SLOP) clearHold();
            if (far < (SLOP[S.type] || SLOP.mouse)) return;
            S.x = x;
            S.y = y;
            // 점 위에서 시작한 끌기(마우스)는 끌어당기기입니다. 회전으로 넘기지 않습니다.
            if (!(!S.touch && S.grab && beginPull(S.node, x, y))) beginOther();
        }
        S.moved = true;
        const now = performance.now();
        if (S.kind === 'rotate') {
            E.dragMove(x - S.x, S.touch ? 0 : y - S.y, (now - S.t) / 1000);
        } else if (S.kind === 'pull') {
            // 포인터가 무대 밖으로 나가면 그만두고 제자리로 돌려보냅니다. 손가락은 가장자리에서 조금 벗어나는 것까지 봐 줍니다
            // (좁은 폰 무대에서 가장자리를 스쳤다고 당기던 것이 끊기지 않게).
            const slack = S.touch ? 28 : 0;
            if (x < -slack || y < -slack || x > w + slack || y > h + slack) {
                cancel();
                return;
            }
            S.pullFar = Math.max(S.pullFar, Math.hypot(x - S.gx, y - S.gy));
            E.pullMove(x, y);
            on.pull?.({ phase: 'move', id: S.node.id, node: S.node.node, x, y, touch: S.touch });
        } else if (S.kind === 'pluck') {
            E.pluckMove(x, y);
        }
        S.x = x;
        S.y = y;
        S.t = now;
        wake();
    }

    // 하던 동작을 끝냅니다. released: 손을 떼서 끝난 것인지(아니면 끊긴 것). pin: 놓은 자리에 고정
    function finish(released, pin) {
        const kind = S.kind;
        const via = S.via;
        clearHold();
        S.kind = 'idle';
        S.pid = -1;
        canvas.style.cursor = '';
        if (via) {
            via.style.cursor = '';
            via.removeEventListener('pointermove', onMove);
            via.removeEventListener('pointerup', onUp);
            via.removeEventListener('pointercancel', onCancel);
            via.removeEventListener('lostpointercapture', onLost);
            S.via = null;
        }
        listen(false);
        if (kind === 'rotate') {
            E.dragEnd(!released);
        } else if (kind === 'pull') {
            const info = E.pullEnd(!released, pin);
            on.pull?.({ phase: 'end', id: S.node.id, node: S.node.node, x: S.x, y: S.y, touch: S.touch, pinned: Boolean(info && info.pinned), cancelled: !released });
        } else if (kind === 'pluck') {
            E.pluckEnd(!released);
        }
        if (S.touch) {
            E.pointerOn = false;
            if (kind === 'pull' || kind === 'rotate') setHover(null);
        }
        wake();
        return kind;
    }

    function cancel() {
        if (S.kind !== 'idle') finish(false, false);
    }

    function onUp(event) {
        S.pointers.delete(event.pointerId);
        if (S.pointers.size < 2) S.pinch = 0;
        if (event.pointerId !== S.pid || S.kind === 'idle') {
            if (event.pointerType === 'touch' && S.pointers.size === 0) E.pointerOn = false;
            return;
        }
        const { node, touch, held, via, kind } = S;
        const how = { touch, named: S.named };
        // 0.3초 안에 떼고 12px 미만으로 움직였으면, 문턱을 넘었더라도 '누름'으로 칩니다.
        const quick = performance.now() - S.t0 <= TAP_MS && S.far < TAP_SLOP;
        if (kind === 'pending') {
            finish(true, false);
            if (node) on.tap(node.node, how);
            else on.emptyTap();
        } else if (kind === 'pull') {
            // 손잡이에서 시작한 끌기는 누름으로 치지 않습니다(이미 고른 점). 길게 눌러 잡았다가 10px 안 움직이고 떼면 누름.
            const tap = !via && (held ? S.pullFar < HOLD_TAP : quick);
            finish(!tap, event.shiftKey && !tap);
            if (tap && node) on.tap(node.node, how);
        } else if (kind === 'rotate') {
            // 점이나 이름표를 누르려다 조금 미끄러진 경우: 돌던 것을 세우고 누름으로 칩니다.
            const tap = quick && Boolean(node);
            finish(!tap, false);
            if (tap) on.tap(node.node, how);
        } else {
            finish(true, false);
        }
    }

    function onCancel(event) {
        S.pointers.delete(event.pointerId);
        if (S.pointers.size < 2) S.pinch = 0;
        if (event.pointerId === S.pid) cancel();
        else if (event.pointerType === 'touch' && S.pointers.size === 0) E.pointerOn = false;
    }

    function onLeave() {
        if (S.kind !== 'idle') return;
        canvas.style.cursor = '';
        setHover(null);
    }

    // 끄는 도중에 포인터를 놓쳤을 때(창이 바뀌는 등): 놓은 것으로 치고 제자리로 돌려보냅니다.
    function onLost(event) {
        S.pointers.delete(event.pointerId);
        if (event.pointerId === S.pid) cancel();
    }

    // 잡은 뒤(또는 줄을 당기는 중)에는 브라우저가 이 터치를 스크롤로 가져가지 못하게 합니다.
    // 끌다가 취소된 경우(무대 밖으로 나감)에도 손가락을 뗄 때까지는 막아 둡니다(당기던 손짓이 갑자기 페이지를 밀지 않게).
    function onTouchMove(event) {
        if (S.kind === 'pull' || S.kind === 'pluck') S.lock = true;
        if (S.lock && event.cancelable) event.preventDefault();
    }

    function onTouchEnd(event) {
        if (event.touches.length === 0) S.lock = false;
    }

    // 길게 누를 때 뜨는 메뉴(안드로이드)를 막습니다. 마우스 오른쪽 단추 메뉴는 그대로 둡니다.
    function onContextMenu(event) {
        if (S.touch && S.kind !== 'idle') event.preventDefault();
    }

    // 고른 점의 손잡이(PlaceGraph 가 그 점 위에 겹쳐 둔 요소)에서 시작하는 끌어당기기: 기다림 없이 바로 잡습니다.
    function pullFrom(event, id, el) {
        if (event.pointerType === 'mouse' && event.button !== 0) return false;
        const p = E.byId.get(id);
        if (!pullable(p)) return false;
        cancel();
        const [x, y] = local(event);
        const now = performance.now();
        const touch = event.pointerType === 'touch';
        Object.assign(S, {
            kind: 'pending', pid: event.pointerId, via: el, x0: x, y0: y, x, y, t: now, t0: now, far: 0,
            touch, type: event.pointerType || 'mouse', node: p, grab: true, label: false, line: null, held: false, moved: false,
        });
        S.named = true;
        if (touch) E.pointerOn = true;
        if (!beginPull(p, x, y)) {
            S.kind = 'idle';
            S.via = null;
            return false;
        }
        el.setPointerCapture?.(event.pointerId);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onCancel);
        el.addEventListener('lostpointercapture', onLost);
        event.preventDefault();
        return true;
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('lostpointercapture', onLost);
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('contextmenu', onContextMenu);
    return {
        pullFrom,
        cancel,
        detach() {
            cancel();
            listen(false);
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointercancel', onCancel);
            canvas.removeEventListener('pointerleave', onLeave);
            canvas.removeEventListener('lostpointercapture', onLost);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('touchcancel', onTouchEnd);
            canvas.removeEventListener('contextmenu', onContextMenu);
        },
    };
}
