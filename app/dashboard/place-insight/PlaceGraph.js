'use client';

// 매장을 한가운데 핵으로 두고 키워드·순위·리뷰·결제·할 일 데이터를 뇌의 뉴런처럼 잇는 3D 그래프입니다.
// 뇌 껍질·연결선·뉴런은 WebGL2 캔버스 한 장에 그리고(graph/ 아래), 글자(라벨·살펴보기 카드·범례)는 그 위의 DOM 으로 올립니다.
// 그리기는 requestAnimationFrame 으로 돌며 React 렌더를 거치지 않고, 화면 밖이거나 탭이 숨으면 멈춥니다.
// 바깥(요약·카드)에서는 ref.focus(id)·ref.ping(id) 로 같은 점을 밝히고, onHover 로 지금 보고 있는 점을 받습니다.
// 점이나 이름을 누르면 살펴보기 카드가 열리고, 카드의 버튼을 눌러야 onSelect 로 본문 이동을 요청합니다.
// 점을 잡아 끌면 이어진 점들이 함께 당겨집니다(판정은 graph/gesture.js, 계산은 graph/pull.js).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import styles from './PlaceGraph.module.css';
import Inspector from './graph/Inspector';
import { buildBrain } from './graph/brain';
import { relationTitle } from './graph/card-model';
import { createEngine, TAG_MAX } from './graph/engine';
import { attachGestures } from './graph/gesture';
import { createRenderer } from './graph/renderer';
import { colorOf, TONES } from './graph/palette';

const GROUP_NAMES = { store: '매장', search: '검색', rival: '경쟁 매장', voice: '리뷰·활동', pay: '결제', todo: '할 일', ops: '운영', geo: 'AI 검색' };
const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// 연결의 갈래 이름과 순서(온톨로지가 families 를 주지 않을 때 씀)
const FAMILY_NAMES = { evidence: '근거', competition: '경쟁', action: '할 일', ai: 'AI 검색', same: '같은 것', registration: '등록', structure: '구조' };
const FAMILY_ORDER = ['evidence', 'competition', 'action', 'ai', 'same', 'registration', 'structure'];
const TAG_SLOTS = Array.from({ length: TAG_MAX }, (_, i) => i);
const PIN_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
// 서버에서 그릴 때는 화면 배치 단계가 없으므로 보통 effect 로 바꿔 씁니다.
const useLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function trackPointer(event) {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`);
}

// headline: 제목 옆에 쓰는 한 문장(지금 이 매장에서 먼저 볼 것). tip: 조작 안내 뒤에 붙일 이 화면만의 한마디.
// hint: 불러오는 중·빈 화면에서 아래 줄에 쓰는 문구(데이터가 있을 때의 조작 안내는 여기서 입력 방식에 맞춰 직접 씁니다).
const PlaceGraph = forwardRef(function PlaceGraph(
    { nodes, links, mode = 'live', label, title = '연결 그래프', headline, legend = [], ontology, hint, tip, onSelect, onHover, children },
    ref,
) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const inspectorRef = useRef(null);
    const toolsRef = useRef(null);
    const dockRef = useRef(null);
    const exitRef = useRef(null);
    const engineRef = useRef(null);
    const gesturesRef = useRef(null);
    const framed = useRef('');
    const els = useRef({ labels: new Map(), leads: new Map(), keys: new Map(), tags: [], pins: [], handle: null, ring: null, tether: null, more: null });
    // 손짓 판정(graph/gesture.js)이 부를 때마다 최신 상태를 보도록 담아 둡니다.
    const hand = useRef({ live: false, loading: false, act: null });
    const hoverCb = useRef(onHover);
    hoverCb.current = onHover;
    // 본문 카드에서 가리킨 점 쪽으로 돌리기를 잠깐 미뤄 두는 타이머(focus 참고)
    const turnTimer = useRef(0);
    // 바깥에서 부르는 open()·state() 가 늘 최신 상태를 보도록 담아 둡니다(렌더마다 아래에서 채움).
    const outer = useRef({ live: false, openId: null, sheet: false, inspect: () => {} });
    useEffect(() => {
        const timer = turnTimer;
        return () => clearTimeout(timer.current);
    }, []);
    const live = mode === 'live';

    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [sheet, setSheet] = useState(false);
    const [turned, setTurned] = useState(false);
    const [hover, setHover] = useState(null);
    const [keyFocus, setKeyFocus] = useState(null);
    const [picked, setPicked] = useState(null);
    // 손가락으로 톡 해서 이름만 띄워 둔 점(카드는 아직 열지 않음). 한 번에 하나만.
    const [peek, setPeek] = useState(null);
    const [linked, setLinked] = useState(null);
    const [linkedGroup, setLinkedGroup] = useState(null);
    const [hoverGroup, setHoverGroup] = useState(null);
    const [pinnedGroup, setPinnedGroup] = useState(null);
    const [relation, setRelation] = useState(null);
    const [klass, setKlass] = useState(null);
    const [relOpen, setRelOpen] = useState(false);
    // 끌어당기는 중인 점({ id, touch }), 방금 손가락으로 놓은 점(이름을 잠깐 더 보여 줌), 고정해 둔 점의 수
    const [pulling, setPulling] = useState(null);
    const [afterPull, setAfterPull] = useState(null);
    const [pins, setPins] = useState(0);
    // 손가락으로 쓰는 중인지(조작 안내와 손잡이를 거기에 맞춥니다)
    const [touchy, setTouchy] = useState(false);
    const [cardTick, setCardTick] = useState(0);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const groups = useMemo(() => new Set(nodes.map((node) => node.group)), [nodes]);
    // 묶음 이름: 온톨로지(groups)가 정한 이름 하나만 씁니다. 없으면 범례의 이름, 그것도 없으면 기본 이름.
    const groupLabels = useMemo(() => {
        const map = new Map(Object.entries(GROUP_NAMES));
        for (const item of legend) map.set(item.group, item.label);
        for (const [key, value] of Object.entries(ontology?.groups || {})) if (value?.label) map.set(key, value.label);
        return map;
    }, [legend, ontology]);

    // 연결 종류 목록(이 그래프에 실제로 나온 것만, 개수와 함께). 갈래별로 묶습니다.
    // 구조 연결(quiet: '묶음에 속함' 같은 뼈대)은 걸러 볼 뜻이 없어(전체가 다 켜짐) 목록에 넣지 않습니다.
    const relationList = useMemo(() => {
        const relations = ontology?.relations;
        if (!relations) return [];
        const families = ontology?.families || {};
        const counts = new Map();
        for (const link of links) if (relations[link.rel] && !relations[link.rel].quiet) counts.set(link.rel, (counts.get(link.rel) || 0) + 1);
        const orderOf = (family) => {
            const given = families[family]?.order;
            if (typeof given === 'number') return given;
            const index = FAMILY_ORDER.indexOf(family);
            return index < 0 ? 50 : index;
        };
        return Object.keys(relations)
            .filter((rel) => counts.has(rel))
            .map((rel, index) => {
                const item = relations[rel];
                return {
                    rel, index,
                    name: item.name || item.label || rel,
                    family: item.family,
                    familyLabel: families[item.family]?.label || FAMILY_NAMES[item.family] || '그 밖',
                    quiet: Boolean(item.quiet),
                    order: orderOf(item.family),
                    count: counts.get(rel),
                };
            })
            .sort((a, b) => a.quiet - b.quiet || a.order - b.order || a.index - b.index);
    }, [links, ontology]);
    const relationFamilies = useMemo(() => {
        const list = [];
        for (const item of relationList) {
            const last = list[list.length - 1];
            if (last && last.label === item.familyLabel && last.quiet === item.quiet) last.items.push(item);
            else list.push({ label: item.familyLabel, quiet: item.quiet, items: [item] });
        }
        return list;
    }, [relationList]);
    // 걸러 보는 묶음 안의 항목 종류(묶음 중심 점은 세지 않습니다 — 띠의 수와 칩의 합이 같게)
    const classList = useMemo(() => {
        const classes = ontology?.classes;
        if (!classes || !pinnedGroup) return [];
        const counts = new Map();
        for (const node of nodes) {
            // 작은 제목 점(묶음 머리, quiet 인 종류)은 항목이 아니므로 칩으로 만들지 않습니다.
            if (node.group === pinnedGroup && node.level >= 2 && classes[node.type] && !classes[node.type].quiet) counts.set(node.type, (counts.get(node.type) || 0) + 1);
        }
        return [...counts].map(([type, count]) => ({ type, label: classes[type].label, count }));
    }, [nodes, ontology, pinnedGroup]);
    const activeRelation = live && relation && relationList.some((item) => item.rel === relation) ? relation : null;
    const activeKlass = live && klass && classList.some((item) => item.type === klass) ? klass : null;

    const selectedId = live && picked && nodeById.has(picked.id) ? picked.id : null;
    const selectedNode = selectedId ? nodeById.get(selectedId) : null;
    const peekId = live && peek && peek !== selectedId && nodeById.has(peek) ? peek : null;
    const watching = hover ?? keyFocus ?? selectedId;
    const self = watching ?? (linked && nodeById.has(linked) ? linked : null);
    const filterGroup = pinnedGroup && groups.has(pinnedGroup) ? pinnedGroup : null;
    const group = self ? null : hoverGroup ?? filterGroup ?? linkedGroup;
    const pullNode = pulling ? nodeById.get(pulling.id) || null : null;
    const readNode = (() => {
        const id = hover ?? keyFocus ?? peekId ?? (selectedId ? null : linked);
        const node = id ? nodeById.get(id) : null;
        // 이름 없는 점(빈 화면의 자리 표시)은 부모 이름으로 읽어 줍니다.
        return node && !(node.full || node.label) ? nodeById.get(node.parent) || node : node;
    })();

    useImperativeHandle(ref, () => ({
        // 'group:search' 처럼 넘기면 점 하나가 아니라 그 묶음 전체를 밝힙니다.
        // 밝히기는 바로 합니다. 그 점이 뇌 뒤쪽에 있으면, 본문 카드에 포인터를 올려 둔 경우에만(0.45초) 보이는 쪽으로 잠깐 돌려 보여 주고,
        // 포인터가 카드를 떠나면 원래 보던 각도로 되돌립니다. 다른 곳으로 가는 길에 카드 위를 스치기만 해서는 장면이 돌지 않고,
        // 끌지 않았는데 장면이 돌아간 채로 남는 일도 없습니다(카드가 열려 있거나 걸러 보는 중에는 아예 돌리지 않습니다 — 엔진의 turnTo 참고).
        // opts.still: 큰 덩어리(구역 전체 등) 위에 포인터가 머무는 경우. 밝히기만 하고 그래프를 돌리지 않습니다.
        focus(id, opts) {
            const still = Boolean(opts?.still);
            const groupId = typeof id === 'string' && id.startsWith('group:') ? id.slice(6) : null;
            const nodeId = !groupId && id && nodeById.has(id) ? id : null;
            setLinkedGroup(groupId);
            setLinked(nodeId);
            clearTimeout(turnTimer.current);
            // 카드에서 옆 카드로 건너가는 사이(잠깐 아무 카드도 아닌 곳)에는 되돌리기를 시작하지 않게 조금 기다립니다.
            turnTimer.current = setTimeout(() => {
                turnTimer.current = 0;
                if (nodeId && !still) engineRef.current?.turnTo(nodeId, true);
                else engineRef.current?.turnBack();
                engineRef.current?.invalidate?.();
            }, nodeId && !still ? 450 : 280);
        },
        ping(id) {
            if (id && nodeById.has(id)) {
                engineRef.current?.ping(id);
                engineRef.current?.invalidate?.();
            }
        },
        // 그 점의 살펴보기 카드를 엽니다(점을 누른 것과 같음). 다른 카드가 열려 있으면 바꾸고, open(null) 은 닫습니다.
        // 없는 id·자리 표시 점·불러오는 중에는 아무 일도 하지 않습니다. 키보드 초점은 옮기지 않습니다.
        open(id) {
            if (id == null) {
                setPicked(null);
                return;
            }
            const node = nodeById.get(id);
            if (!node || node.ghost || !outer.current.live) return;
            setPeek(null);
            outer.current.inspect(id, null, false);
        },
        // 지금 열려 있는 카드의 점 id(없으면 null)와, 이 화면에서 카드가 아래 시트로 뜨는지
        state() {
            return { openId: outer.current.openId, sheet: outer.current.sheet };
        },
    }), [nodeById]);

    useEffect(() => {
        hoverCb.current?.(watching ? nodeById.get(watching) || null : null);
    }, [watching, nodeById]);

    /* ───────── 캔버스·장면 준비 ───────── */

    // 이 effect 가 장면을 만들고, 아래 effect 들이 그 장면에 그래프·상태를 넣습니다(같은 단계에서 적힌 순서대로 실행됨).
    useLayout(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;
        const renderer = createRenderer(canvas);
        if (!renderer) {
            setFailed(true);
            return undefined;
        }
        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const E = createEngine(renderer);
        E.reduced = motionQuery.matches;
        E.coarse = window.matchMedia('(pointer: coarse)').matches;
        engineRef.current = E;
        setTouchy(E.coarse);
        // 개발 중 확인용(점 자리·프레임 시간을 콘솔에서 볼 수 있게). 운영 빌드에서는 빠집니다.
        if (process.env.NODE_ENV !== 'production') window.__placeGraph = E;

        let raf = 0;
        let running = false;
        let visible = true;
        let disposed = false;
        const tick = (now) => {
            raf = 0;
            E.frame(now);
            // 끌어당긴 것이 돌아오는 중이거나 길게 누르는 고리가 차오르는 중이면, 반복 그리기가 멈춘 상태(움직임 줄이기)에서도 이어서 그립니다.
            if (!raf && (running || E.pull.awake || E.charge)) raf = requestAnimationFrame(tick);
        };
        const start = () => {
            if (running || E.reduced || !visible || document.hidden || renderer.lost) return;
            running = true;
            E.last = 0;
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const stop = () => {
            running = false;
            cancelAnimationFrame(raf);
            raf = 0;
        };
        // 반복 그리기가 멈춰 있을 때(움직임 줄이기·화면 밖)에도 바뀐 내용을 한 번은 그립니다.
        E.invalidate = () => {
            if (!raf && !disposed) raf = requestAnimationFrame(tick);
        };
        renderer.onRestore = () => {
            E.setGraph(E.list.map((p) => p.node), E.links.map((line) => line.link));
            if (E.brain) E.setBrain(E.brain);
            start();
            E.invalidate();
        };

        // 관계 이름표의 글자를 바꾸고 크기를 재 둡니다(고른 점이 바뀔 때만).
        E.onTags = (tags) => {
            els.current.tags.forEach((el, i) => {
                if (!el) return;
                const tag = tags[i];
                if (!tag) return;
                if (el.textContent !== tag.text) el.textContent = tag.text;
                tag.w = el.offsetWidth;
                tag.h = el.offsetHeight;
            });
        };

        // 라벨·지시선을 화면 자리에 맞춥니다(프레임마다, React 를 거치지 않고 바로).
        let turnedNow = false;
        const spot = [0, 0, 0, 0];
        E.onFrame = () => {
            const { labels, leads } = els.current;
            const snap = E.dpr;
            for (const p of E.list) {
                const lab = p.lab;
                const el = labels.get(p.id);
                if (!el) continue;
                const visibleNow = lab.a > 0;
                if (visibleNow) {
                    const x = Math.round(lab.x * snap) / snap;
                    const y = Math.round(lab.y * snap) / snap;
                    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
                    el.style.opacity = (lab.a * (1 - 0.5 * p.dim)).toFixed(3);
                }
                if (visibleNow !== lab.vis) {
                    lab.vis = visibleNow;
                    el.style.visibility = visibleNow ? 'visible' : 'hidden';
                }
                // (톡 해서 띄운 이름 쪽지의 모양은 React 가 data-note 로 붙입니다. 쪽지의 크기를 재서 자리를 잡아야 하기 때문입니다.)
                const state = lab.loose ? 'held' : p.id === E.selfId || p.id === E.selectedId ? 'self' : p.tHot ? 'hot' : '';
                if (state !== lab.state) {
                    lab.state = state;
                    el.dataset.state = state;
                }
                const lead = leads.get(p.id);
                if (!lead) continue;
                const leadNow = visibleNow && lab.lead;
                if (leadNow) {
                    // 쪽지의 지시선은 실선으로 또렷하게(쪽지가 어느 점의 이름인지 바로 보이게)
                    const note = p.id === E.peekId;
                    if (lead.dataset.state !== (note ? 'held' : '')) lead.dataset.state = note ? 'held' : '';
                    lead.setAttribute('x1', lab.ax.toFixed(1));
                    lead.setAttribute('y1', lab.ay.toFixed(1));
                    lead.setAttribute('x2', lab.bx.toFixed(1));
                    lead.setAttribute('y2', lab.by.toFixed(1));
                    lead.style.opacity = (lab.a * (1 - 0.6 * p.dim) * (note ? 0.8 : p.level <= 1 ? 0.5 : 0.36)).toFixed(3);
                }
                if (leadNow !== lab.leadVis) {
                    lab.leadVis = leadNow;
                    lead.style.visibility = leadNow ? 'visible' : 'hidden';
                }
            }
            // 관계 이름표(고른 점의 연결 묶음마다 하나)
            const pool = els.current.tags;
            for (let i = 0; i < pool.length; i += 1) {
                const el = pool[i];
                if (!el) continue;
                const tag = E.tags[i];
                const on = Boolean(tag && tag.a > 0.01);
                if (on) {
                    el.style.transform = `translate3d(${Math.round(tag.x * snap) / snap}px, ${Math.round(tag.y * snap) / snap}px, 0)`;
                    el.style.opacity = tag.a.toFixed(3);
                }
                if (el.dataset.on !== String(on)) {
                    el.dataset.on = String(on);
                    el.style.visibility = on ? 'visible' : 'hidden';
                }
            }
            // 자리가 없어 숨긴 관계 이름표의 수("연결 종류 +3")
            const moreEl = els.current.more;
            if (moreEl) {
                const more = E.more;
                if (moreEl.dataset.n !== String(more.n)) {
                    moreEl.dataset.n = String(more.n);
                    if (more.n > 0) {
                        moreEl.textContent = `연결 종류 +${more.n}`;
                        more.w = moreEl.offsetWidth;
                        more.h = moreEl.offsetHeight;
                    }
                }
                const on = more.a > 0.01;
                if (on) {
                    moreEl.style.transform = `translate3d(${Math.round(more.x * snap) / snap}px, ${Math.round(more.y * snap) / snap}px, 0)`;
                    moreEl.style.opacity = more.a.toFixed(3);
                }
                if (moreEl.dataset.on !== String(on)) {
                    moreEl.dataset.on = String(on);
                    moreEl.style.visibility = on ? 'visible' : 'hidden';
                }
            }
            const focused = E.focusId ? E.byId.get(E.focusId) : null;
            const key = focused ? els.current.keys.get(focused.id) : null;
            if (key) key.style.transform = `translate(${Math.round(focused.sx - 22)}px, ${Math.round(focused.sy - 22)}px)`;
            // 고른 점의 손잡이(손가락으로 당길 때 잡는 고리)는 그 점을 따라다닙니다.
            const handle = els.current.handle;
            const chosen = handle && E.selectedId ? E.byId.get(E.selectedId) : null;
            if (chosen) handle.style.transform = `translate(${Math.round(chosen.sx - 22)}px, ${Math.round(chosen.sy - 22)}px)`;
            // 고정해 둔 점: 원래 자리에 옅은 빈 고리를 남기고, 지금 자리까지 가는 선으로 잇습니다.
            const marks = els.current.pins;
            for (let i = 0; i < marks.length; i += 1) {
                const mark = marks[i];
                if (!mark) continue;
                const p = E.pins[i];
                if (p) {
                    E.project(p.at, spot);
                    mark.firstChild.setAttribute('cx', spot[0].toFixed(1));
                    mark.firstChild.setAttribute('cy', spot[1].toFixed(1));
                    mark.lastChild.setAttribute('x1', spot[0].toFixed(1));
                    mark.lastChild.setAttribute('y1', spot[1].toFixed(1));
                    mark.lastChild.setAttribute('x2', p.sx.toFixed(1));
                    mark.lastChild.setAttribute('y2', p.sy.toFixed(1));
                }
                const on = Boolean(p);
                if (mark.dataset.on !== String(on)) {
                    mark.dataset.on = String(on);
                    mark.style.visibility = on ? 'visible' : 'hidden';
                }
            }
            // 손가락으로 당길 때: 손가락과 위로 빼낸 점을 가는 선으로 잇습니다(무엇을 잡고 있는지 보이게).
            // 마우스는 한계보다 멀리 당겨 점이 포인터에서 떨어졌을 때만 잇습니다.
            const tether = els.current.tether;
            if (tether) {
                const grabbed = E.grab && !E.auto ? E.grab : null;
                const held = grabbed && (grabbed.touch || Math.hypot(grabbed.x - grabbed.p.sx, grabbed.y - grabbed.p.sy) > 10) ? grabbed : null;
                if (held) {
                    tether.setAttribute('x1', held.x.toFixed(1));
                    tether.setAttribute('y1', held.y.toFixed(1));
                    tether.setAttribute('x2', held.p.sx.toFixed(1));
                    tether.setAttribute('y2', held.p.sy.toFixed(1));
                }
                const on = Boolean(held);
                if (tether.dataset.on !== String(on)) {
                    tether.dataset.on = String(on);
                    tether.style.visibility = on ? 'visible' : 'hidden';
                }
            }
            if (E.cam.moved !== turnedNow) {
                turnedNow = E.cam.moved;
                setTurned(turnedNow);
            }
        };

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            const w = Math.max(240, Math.round(rect.width));
            const h = Math.max(200, Math.round(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, E.dprCap);
            if (w === E.w && h === E.h && dpr === E.dpr) return;
            E.setSize(w, h, dpr);
            setSheet(w < 520);
            setCardTick((count) => count + 1);
            // 크기를 바꾸면 캔버스가 지워지므로 같은 순간에 바로 다시 그립니다(깜빡임 방지).
            E.last = 0;
            E.frame(performance.now());
        };
        const onMotion = () => {
            E.reduced = motionQuery.matches;
            if (E.reduced) stop();
            else start();
            E.invalidate();
        };
        const onVisibility = () => (document.hidden ? stop() : start());
        // 휠은 페이지 스크롤로 두고, ⌘/Ctrl 을 누른 채 굴릴 때(트랙패드로 벌리기 포함)만 확대합니다.
        const onWheel = (event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            E.zoomBy(Math.exp(-event.deltaY * 0.0045));
            E.invalidate();
        };

        resize();
        // 뇌 형상은 조금씩 나눠 계산합니다(첫 화면이 멈추지 않도록). 다 되면 가운데에서 바깥으로 떠오릅니다.
        buildBrain(E.lite ? 'lite' : 'full').then((brain) => {
            if (disposed) return;
            E.setBrain(brain);
            setReady(true);
            E.invalidate();
        });
        const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
        sizeObserver?.observe(wrap);
        // 무대가 화면에 얼마나 보이는지(0~1)도 엔진에 알립니다. 거의 안 보일 때는 본문 카드에 올려 둔 점 쪽으로 그래프를 돌리지 않습니다(엔진의 turnTo).
        const viewObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            visible = entry.isIntersecting;
            E.seen = entry.intersectionRatio;
            if (visible) start();
            else stop();
        }, { threshold: [0, 0.1, 0.2, 0.3, 0.34, 0.4, 0.5, 0.6, 0.8, 1] });
        viewObserver?.observe(wrap);
        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', onVisibility);
        motionQuery.addEventListener?.('change', onMotion);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        // 손짓(누르기·끌어당기기·줄 튕기기·회전·벌려서 확대)은 graph/gesture.js 가 판정하고, 여기서는 그 결과만 받습니다.
        const gestures = attachGestures(canvas, E, {
            live: () => hand.current.live,
            loading: () => hand.current.loading,
            hover: (id) => {
                setHover(id);
                if (id) setPeek(null);
            },
            tap: (node, how) => {
                // 손가락으로 이름이 꺼진 점을 처음 톡 하면 카드를 열지 않고 이름만 띄웁니다(스친 터치 한 번에 낯선 카드가 열리지 않게).
                // 그 이름이나 같은 점을 한 번 더 누르면 카드가 열립니다. 이름이 떠 있는 점·묶음·매장은 첫 톡에 엽니다.
                if (how && how.touch && !how.named && hand.current.live && hand.current.peek !== node.id && !node.ghost && (node.label || node.full)) {
                    setPeek(node.id);
                    return;
                }
                setPeek(null);
                hand.current.act?.(node, false);
            },
            emptyTap: () => {
                setPeek(null);
                if (hand.current.live) setPicked(null);
            },
            pull: (info) => {
                // 손가락 둘레의 가는 고리는 손가락을 그대로 따라다닙니다(React 를 거치지 않고 바로).
                const ring = els.current.ring;
                if (ring && info.touch && info.phase !== 'end') ring.style.transform = `translate(${Math.round(info.x - 38)}px, ${Math.round(info.y - 38)}px)`;
                if (info.phase === 'start') {
                    setAfterPull(null);
                    setPulling({ id: info.id, touch: info.touch });
                } else if (info.phase === 'end') {
                    setPulling(null);
                    setPins(E.pins.length);
                    if (info.touch) setAfterPull(info.id);
                }
            },
        });
        gesturesRef.current = gestures;
        start();
        E.invalidate();
        return () => {
            disposed = true;
            stop();
            gestures.detach();
            gesturesRef.current = null;
            E.dispose();
            renderer.dispose();
            engineRef.current = null;
            sizeObserver?.disconnect();
            viewObserver?.disconnect();
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', onVisibility);
            motionQuery.removeEventListener?.('change', onMotion);
            canvas.removeEventListener('wheel', onWheel);
        };
    }, []);

    // 라벨 크기를 재 둡니다(자리 잡기에 씀). 웹 글꼴이 늦게 들어오면 폭이 달라지므로 그때 다시 잽니다.
    const measure = useCallback(() => {
        const E = engineRef.current;
        if (!E) return;
        const metrics = new Map();
        for (const [id, el] of els.current.labels) {
            if (el.offsetWidth) metrics.set(id, { w: el.offsetWidth, h: el.offsetHeight });
        }
        E.labels.metrics = metrics;
        E.invalidate?.();
    }, []);

    useLayout(() => {
        const E = engineRef.current;
        if (!E) return undefined;
        E.relations = ontology?.relations || {};
        // 관계 이름표는 살펴보기 카드의 묶음 제목과 같은 말을 씁니다(card-model 의 relationTitle).
        E.titleOf = ontology?.relations ? (rel, asSubject) => relationTitle(rel, asSubject ? 'out' : 'in', ontology) : null;
        E.setGraph(nodes, links);
        setPins(0);
        measure();
        let alive = true;
        document.fonts?.ready?.then(() => alive && measure());
        return () => {
            alive = false;
        };
    }, [nodes, links, ontology, measure, failed]);

    // 글자 크기가 화면 폭에 따라 달라지므로(폰은 더 큼), 좁은 배치와 넓은 배치가 바뀌면 라벨 크기를 다시 잽니다.
    useLayout(() => {
        measure();
    }, [sheet, measure]);

    useEffect(() => {
        const E = engineRef.current;
        if (!E) return;
        E.setMode(mode);
        E.invalidate?.();
        if (mode !== 'live') {
            setPicked(null);
            setPinnedGroup(null);
            setRelation(null);
            setKlass(null);
            setRelOpen(false);
        }
    }, [mode]);

    // 무엇을 밝힐지(올린 점·걸러 보기)를 장면에 넘깁니다. 아래의 '맞춰 보기'보다 먼저 실행되어야 합니다.
    useLayout(() => {
        const E = engineRef.current;
        if (!E) return;
        E.setSelf(self);
        E.setGroup(group);
        E.setRelation(activeRelation);
        E.setKlass(activeKlass);
        E.focusId = keyFocus;
        E.peekId = peekId;
        E.invalidate?.();
    }, [self, group, activeRelation, activeKlass, keyFocus, peekId]);

    // 쪽지는 이름만 적어 보통 이름표보다 작습니다. 쪽지가 뜨거나 꺼질 때 이름표 크기를 다시 재 둡니다(그 크기로 점 곁에 자리를 잡음).
    useLayout(() => {
        measure();
    }, [peekId, measure]);

    // 카드를 열거나 걸러 보기를 바꾸면 톡 해서 띄운 이름은 지웁니다.
    useEffect(() => {
        setPeek(null);
    }, [selectedId, pinnedGroup, relation, klass]);

    // 카드·시트가 덮지 않는 영역을 장면에 알려 주고, 고른 점(또는 걸러 본 점들)이 그 안에 들어오게 맞춥니다.
    // 라벨도 카드·단추 밑으로 들어가지 않게 합니다.
    useLayout(() => {
        const E = engineRef.current;
        const wrap = wrapRef.current;
        if (!E || !wrap) return;
        const base = wrap.getBoundingClientRect();
        const blocks = [];
        E.setLinkHot(null);
        for (const el of [toolsRef.current, dockRef.current]) {
            if (!el) continue;
            const box = el.getBoundingClientRect();
            if (box.width) blocks.push([box.left - base.left, box.top - base.top, box.right - base.left, box.bottom - base.top]);
        }
        let right = base.width;
        let bottom = base.height;
        // 자리(slot)는 카드보다 클 수 있으므로(폰 시트는 '최대 영역'), 가려지는 곳은 카드의 실제 상자로 잽니다.
        // 들고나는 움직임과 상관없이, 카드가 자리 잡았을 때의 상자를 씁니다(offset 값은 transform 의 영향을 받지 않음).
        const slot = selectedId ? inspectorRef.current : null;
        const card = slot ? slot.firstElementChild || slot : null;
        if (card) {
            const left = card === slot ? slot.offsetLeft : slot.offsetLeft + card.offsetLeft;
            const top = card === slot ? slot.offsetTop : slot.offsetTop + card.offsetTop;
            blocks.push([left, top, left + card.offsetWidth, top + card.offsetHeight]);
            // (무대가 아주 낮으면 시트 위 띠가 93px 까지 줄 수 있습니다.)
            if (sheet) bottom = Math.max(80, top - 6);
            else right = Math.max(240, left - 6);
        } else if (sheet && toolsRef.current) {
            // 폰의 쉬는 화면: 아래 가장자리의 단추 줄(확대·연결 종류)이 뇌를 가리지 않게 그 위쪽에 뇌를 둡니다.
            bottom = Math.max(160, toolsRef.current.offsetTop - 6);
        }
        E.labels.blocks = blocks;
        // 손가락 화면에서 고른 점 둘레에 뜨는 손잡이 고리(44px)의 반지름. 이름표가 그 위에 얹히지 않게 엔진에 알려 줍니다.
        E.handleR = touchy && selectedId ? 24 : 0;
        E.selectedId = selectedId;
        const key = `${selectedId || ''}|${filterGroup || ''}|${activeRelation || ''}|${activeKlass || ''}`;
        if (key === framed.current) {
            // 보는 것은 그대로이고 자리만 바뀐 경우(시트가 접힘·펼쳐짐, 무대 크기 변화)
            E.setSafe(0, 0, right, bottom);
        } else {
            framed.current = key;
            E.safe = [0, 0, right, bottom];
            if (selectedId) E.lookAt(selectedId);
            else if (activeRelation) E.lookAtLit({ relation: activeRelation });
            else if (activeKlass) E.lookAtLit({ klass: activeKlass, group: filterGroup });
            else if (filterGroup) E.lookAtGroup(filterGroup);
            else E.release();
        }
        E.invalidate?.();
    }, [selectedId, filterGroup, activeRelation, activeKlass, sheet, ready, relOpen, relationList.length, cardTick, pins, touchy]);

    // 카드(시트)의 크기가 바뀌면(끄는 동안 접힘 등) 가려지지 않는 영역을 다시 잽니다.
    useEffect(() => {
        const slot = selectedId ? inspectorRef.current : null;
        if (!slot || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => setCardTick((count) => count + 1));
        // 카드 높이는 고른 점·보기 방식·접힘에 따라 바뀝니다. 자리와 카드를 함께 지켜봅니다.
        observer.observe(slot);
        if (slot.firstElementChild) observer.observe(slot.firstElementChild);
        return () => observer.disconnect();
    }, [selectedId]);

    // 손가락으로 놓은 점의 이름은 0.8초 더 보여 주고 지웁니다.
    useEffect(() => {
        if (!afterPull) return undefined;
        const timer = setTimeout(() => setAfterPull(null), 800);
        return () => clearTimeout(timer);
    }, [afterPull]);

    /* ───────── 고르기·살펴보기 ───────── */

    // origin: 이름표(또는 눌린 조각)가 있던 화면 자리. 카드 제목이 거기서 날아옵니다.
    const inspect = useCallback((id, origin, byKey = false) => {
        const E = engineRef.current;
        let from = origin;
        if (!from && E) {
            const p = E.byId.get(id);
            const el = els.current.labels.get(id);
            if (p && el && p.lab.a > 0.5) {
                const box = el.getBoundingClientRect();
                from = { x: box.left, y: box.top, h: box.height };
            } else if (p && wrapRef.current) {
                const base = wrapRef.current.getBoundingClientRect();
                from = { x: base.left + p.sx, y: base.top + p.sy - 8, h: 14 };
            }
        }
        setPicked({ id, origin: from || null, byKey });
    }, []);

    const close = useCallback((byKey) => {
        setPicked((prev) => {
            // 키보드로 연 카드를 닫을 때만 초점을 그 점으로 돌려줍니다(마우스로 연 경우에는 강조가 남지 않게 그대로 둠).
            if (byKey && prev?.byKey) requestAnimationFrame(() => els.current.keys.get(prev.id)?.focus({ preventScroll: true }));
            return null;
        });
    }, []);

    // 살펴보기 카드가 열려 있는 동안에는 초점이 어디에 있든 Esc 로 닫습니다.
    useEffect(() => {
        if (!selectedId) return undefined;
        const onEscape = (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) close(Boolean(picked?.byKey));
        };
        document.addEventListener('keydown', onEscape);
        return () => document.removeEventListener('keydown', onEscape);
    }, [selectedId, picked, close]);

    const act = (node, byKey) => {
        if (mode === 'loading') return;
        if (!live) {
            onSelect?.(node);
            return;
        }
        if (node.ghost) return;
        inspect(node.id, null, byKey);
    };
    // 무대의 손짓은 graph/gesture.js 가 받습니다(위의 attachGestures). 누르기만 한 경우 여기 act 로 옵니다.
    hand.current = { live, loading: mode === 'loading', act, peek: peekId };
    outer.current = { live, openId: selectedId, sheet, inspect };

    const onKey = (event, node) => {
        const E = engineRef.current;
        if (event.key === 'Escape') {
            // 카드가 열려 있으면 닫고(초점은 그 점에 남음), 아니면 그래프 밖으로 나갑니다(다음 Tab 이 그래프 뒤로 이어짐).
            event.preventDefault();
            if (picked) close(true);
            else exitRef.current?.focus({ preventScroll: true });
            return;
        }
        const arrow = ARROWS[event.key];
        if (!arrow || !E) return;
        event.preventDefault();
        // 화살표: 이어진 점 가운데 그 방향에 있는 점으로 옮겨 갑니다.
        const from = E.byId.get(node.id);
        if (!from) return;
        let best = null;
        let score = 0.2;
        for (const line of from.links) {
            const other = line.a === from ? line.b : line.a;
            const dx = other.sx - from.sx;
            const dy = other.sy - from.sy;
            const far = Math.hypot(dx, dy) || 1;
            const along = (dx * arrow[0] + dy * arrow[1]) / far;
            if (along > score) {
                score = along;
                best = other;
            }
        }
        if (best) {
            els.current.keys.get(best.id)?.focus({ preventScroll: true });
        } else {
            // 그 방향에 이어진 점이 없으면: 점이 그쪽으로 살짝 밀렸다 돌아옵니다("더 갈 곳이 없다"는 반응).
            E.bump(node.id, arrow[0], arrow[1]);
            E.invalidate?.();
        }
    };

    const zoom = (factor) => {
        engineRef.current?.zoomBy(factor);
        engineRef.current?.invalidate?.();
    };

    // 연결 종류를 고르면 그 연결만 봅니다. 묶음·종류를 걸러 보던 것은 지우지 않고 두었다가, 연결 종류를 끄면 그대로 돌아옵니다.
    const chooseRelation = (rel) => {
        setPicked(null);
        setRelOpen(false);
        setRelation((prev) => (prev === rel ? null : rel));
    };

    const unpin = () => {
        engineRef.current?.unpinAll();
        engineRef.current?.invalidate?.();
        setPins(0);
    };

    const reset = () => {
        setPinnedGroup(null);
        setRelation(null);
        setKlass(null);
        setPicked(null);
        engineRef.current?.home();
        engineRef.current?.invalidate?.();
        setPins(0);
    };

    const shownLegend = legend.filter((item) => groups.has(item.group));
    // 묶음마다 걸러 볼 항목의 수(띠의 '항목 N'과 같은 기준: 작은 제목 점과 종류를 모르는 점은 뺌). 0이면 범례 단추를 눌러도 볼 것이 없어 흐리게 두고 누를 수 없게 합니다.
    const groupItemCount = useMemo(() => {
        const classes = ontology?.classes;
        const map = new Map();
        for (const node of nodes) {
            if (node.level < 2) continue;
            if (classes && (!classes[node.type] || classes[node.type].quiet)) continue;
            map.set(node.group, (map.get(node.group) || 0) + 1);
        }
        return map;
    }, [nodes, ontology]);
    const filtering = Boolean(activeRelation || filterGroup);
    // 걸러 보는 동안 밝혀진 점 가운데 이름이 켜진 점의 수. 좁은 화면에서는 이름표 자리가 모자라 일부 점의 이름이 빠질 수 있어,
    // 이름이 다 켜지지 않았을 때만 띠와 아래 줄에서 말없이 빠지지 않게 알립니다(엔진 상태를 읽기만 하고 자리 찾기는 건드리지 않음).
    const [nameStat, setNameStat] = useState(null);
    // 항목이 없어 흐리게 둔 범례 단추를 눌렀을 때 아래 줄에 잠깐(6초) 이유를 보여 줍니다(짧으면 읽기 전에 사라져 놓치기 쉽습니다).
    const [emptyGroup, setEmptyGroup] = useState(null);
    useEffect(() => {
        if (!emptyGroup) return undefined;
        const timer = setTimeout(() => setEmptyGroup(null), 6000);
        return () => clearTimeout(timer);
    }, [emptyGroup]);
    // 안내가 길어진 만큼, 그 사이에 점을 가리키거나 누르면 안내는 거두어 점의 이름이 지나간 뒤에 옛 안내가 다시 나오지 않게 합니다.
    // (점을 눌러 카드가 열리는 경우도 같습니다. 카드가 열리면 읽는 점이 없어도 안내를 거둡니다.)
    const readId = readNode ? readNode.id : null;
    useEffect(() => {
        if (readId || selectedId) setEmptyGroup(null);
    }, [readId, selectedId]);
    // 걸러 보는 대상이 바뀌면(묶음·연결·종류) 이름표가 다시 자리를 잡으므로, 그때마다 '자리 잡는 중'으로 돌아갑니다.
    const nameKey = `${activeRelation || ''}|${filterGroup || ''}|${activeKlass || ''}`;
    useEffect(() => {
        if (!filtering || !live) {
            setNameStat(null);
            return undefined;
        }
        const classes = ontology?.classes;
        // 걸러 본 직후에는 이름표가 하나씩 켜지는 중이라 '이름 0/16' 같은 중간 값이 보입니다.
        // 같은 값이 연속으로 읽히고(자리가 잡히고) 걸러 본 지 1초가 지난 뒤에만 '자리 잡은 값'으로 칩니다.
        const startedAt = Date.now();
        let lastKey = '';
        let sameReads = 0;
        const read = () => {
            const engine = engineRef.current;
            const hot = engine?.hotSet;
            if (!engine || !hot || !engine.byId) return;
            let total = 0;
            let named = 0;
            for (const id of hot) {
                const p = engine.byId.get(id);
                // 매장·묶음 중심(level 0·1)은 늘 이름이 있어 세지 않습니다.
                if (!p || p.level <= 1 || p.shown < 0.5) continue;
                // 띠의 '항목 N'(종류 칩의 합)과 같은 기준으로 세려고, 작은 제목 점(quiet 인 종류)과 종류를 모르는 점은 뺍니다.
                const kind = classes ? classes[p.node.type] : null;
                if (classes && (!kind || kind.quiet)) continue;
                total += 1;
                if (p.lab && p.lab.on && p.lab.a > 0.5) named += 1;
            }
            const key = `${named}/${total}`;
            sameReads = key === lastKey ? sameReads + 1 : 0;
            lastKey = key;
            // 값이 연속으로 같고 1초가 지났거나, 그래프가 돌면서 값이 계속 흔들려도 3초가 지나면 '자리 잡은 값'으로 칩니다.
            const elapsed = Date.now() - startedAt;
            const settled = (sameReads >= 2 && elapsed >= 1000) || elapsed >= 3000;
            setNameStat((prev) => (prev && prev.named === named && prev.total === total && prev.settled === settled ? prev : { named, total, settled }));
        };
        read();
        const timer = setInterval(read, 400);
        return () => clearInterval(timer);
    }, [filtering, live, ontology, nameKey]);
    // 자리가 잡히기 전의 값(이름표가 켜지는 중)은 '모자란다'고 알리지 않습니다.
    const namesMissing = filtering && nameStat && nameStat.settled && nameStat.total > 0 && nameStat.named < nameStat.total;
    const relationItem = activeRelation ? relationList.find((item) => item.rel === activeRelation) : null;
    const klassItem = activeKlass ? classList.find((item) => item.type === activeKlass) : null;
    // 띠에 쓰는 수: 종류 칩의 합과 같게(묶음 중심 점은 세지 않음)
    const filterCount = filterGroup ? classList.reduce((sum, item) => sum + item.count, 0) || nodes.filter((node) => node.group === filterGroup && node.level >= 2).length : 0;
    // (묶음 중심 점을 고른 경우는 뺍니다. 띠에 '키워드 순위 › 키워드 순위' 처럼 같은 말이 두 번 적히므로, 그때는 '○○만 보는 중' 그대로 둡니다.)
    const selectedInFilter = selectedNode && filterGroup && !activeRelation && selectedNode.group === filterGroup && selectedNode.level >= 2 ? selectedNode : null;
    // 걸러 보는 묶음 밖의 점을 고른 경우(카드의 연결된 항목으로 건너감, 매장 점을 고름): 띠에 그 점의 이름을 함께 적습니다.
    const selectedOutside = selectedNode && filterGroup && !activeRelation && selectedNode.group !== filterGroup ? selectedNode : null;
    // 손가락으로 톡 해서 이름만 띄워 둔 점을 아래 줄이 읽어 주는 중인지
    const peekShown = Boolean(peekId) && Boolean(readNode) && readNode.id === peekId && !hover && !keyFocus;
    // 폰처럼 좁은 무대에서 여럿을 걸러 볼 때는 이름표에서 값(sub)을 빼고 이름만 띄웁니다(이름이 더 많이 들어가게). 값은 카드에서 봅니다.
    const litCount = relationItem ? relationItem.count : klassItem ? klassItem.count : filterCount;
    const compact = sheet && filtering && litCount > 6;
    useLayout(() => {
        measure();
    }, [compact, measure]);
    const heldNode = pullNode || (afterPull ? nodeById.get(afterPull) || null : null);
    // 위 띠에 쓰는 짧은 이름: 이름표의 이름(label)을 씁니다. 그 이름도 문장이면(말줄임으로 끝나거나 긴 이름) 종류 이름으로 대신합니다
    // (예: 'AI 검색 › AI 브리핑 문장 살펴보는 중'). 문장 전체는 카드 제목에서 읽습니다.
    const bandName = (node) => {
        const name = node.label || node.full || '';
        if (name.length <= 12 && !name.endsWith('…')) return name;
        const kind = ontology?.classes?.[node.type];
        return kind && !kind.quiet && kind.label ? kind.label : name;
    };

    // 조작 안내: 마우스와 손가락은 하는 법이 달라서 따로 씁니다.
    // (어느 쪽이든 아래 줄의 높이는 같습니다. 입력 방식이 바뀌어도 무대가 밀리지 않게 CSS 에서 높이를 고정해 둡니다.)
    const guide = namesMissing
        ? '이름이 보이지 않는 점은 점을 누르면 이름이 보입니다. 이름을 누르면 살펴봅니다.'
        : touchy
        ? '점을 누르면 이름, 이름을 누르면 살펴봅니다 · 점을 길게 눌러 끌면 당겨집니다 · 옆으로 쓸면 돕니다'
        : `점이나 이름을 누르면 살펴봅니다 · 점을 끌면 이어진 점이 따라옵니다 · 빈 곳을 끌면 돌아갑니다 · 위의 묶음 이름을 누르면 그 묶음만 봅니다${tip ? ` · ${tip}` : ''}`;

    return (
        <div
            className={styles.panel}
            data-mode={mode}
            data-filter={filtering ? 'true' : 'false'}
            data-touch={touchy ? 'true' : 'false'}
            style={activeRelation ? { '--f': '#F3EDE0' } : filterGroup ? { '--f': colorOf(filterGroup).hex } : undefined}
        >
            <header className={styles.head}>
                <p className={styles.headTitle}>
                    <strong>{title}</strong>
                    {headline && <span className={styles.headline}>{headline}</span>}
                    <span className={styles.counts}>항목 {nodes.length} · 연결 {links.length}</span>
                </p>
                {shownLegend.length > 0 && (
                    <ul className={styles.legend} aria-label="묶음. 누르면 그 묶음만 가까이 봅니다.">
                        {shownLegend.map((item) => {
                            const empty = (groupItemCount.get(item.group) || 0) === 0;
                            return (
                                <li key={item.group} data-group={item.group}>
                                    <button
                                        type="button"
                                        style={{ '--c': colorOf(item.group).hex, '--cv': colorOf(item.group).vividHex }}
                                        aria-pressed={filterGroup === item.group}
                                        aria-disabled={empty ? 'true' : undefined}
                                        data-empty={empty ? 'true' : undefined}
                                        title={empty ? '이 묶음에는 따로 살펴볼 항목이 없습니다.' : undefined}
                                        onClick={() => {
                                            if (!live) return;
                                            if (empty) {
                                                setEmptyGroup(item.group);
                                                return;
                                            }
                                            setEmptyGroup(null);
                                            setPicked(null);
                                            setRelation(null);
                                            setKlass(null);
                                            setPinnedGroup((prev) => (prev === item.group ? null : item.group));
                                        }}
                                        onPointerMove={trackPointer}
                                        onPointerEnter={(event) => {
                                            if (event.pointerType !== 'touch' && !empty) setHoverGroup(item.group);
                                        }}
                                        onPointerLeave={() => setHoverGroup(null)}
                                        onFocus={() => { if (!empty) setHoverGroup(item.group); }}
                                        onBlur={() => setHoverGroup(null)}
                                    >
                                        <i aria-hidden="true" />
                                        {item.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </header>

            {/* 걸러 보는 중임을 알리는 띠: 무대 위에 겹치지 않고 따로 한 줄을 씁니다(이름표·점을 가리지 않게). */}
            <AnimatePresence initial={false}>
                {filtering && (
                    <motion.div
                        key="modebar"
                        className={styles.modebar}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                    >
                        <p className={styles.modeText}>
                            <i aria-hidden="true" />
                            {/* 줄이 넘어갈 때 "중" 한 글자만 떨어지지 않게, 끝말은 한 덩어리(keep)로 묶어 둡니다. */}
                            <span>
                            {relationItem && selectedNode ? (
                                <span><strong>{relationItem.name}</strong> <b aria-hidden="true">›</b> <strong>{bandName(selectedNode)}</strong> <span className={styles.keep}>살펴보는 중</span></span>
                            ) : relationItem ? (
                                <span><strong>{relationItem.name}</strong> <span className={styles.keep}>연결만 보는 중</span> <span className={styles.keep}>· 연결 {relationItem.count}</span></span>
                            ) : selectedInFilter ? (
                                <span><strong>{groupLabels.get(filterGroup)}</strong> <b aria-hidden="true">›</b> <strong>{bandName(selectedInFilter)}</strong> <span className={styles.keep}>살펴보는 중</span></span>
                            ) : selectedOutside ? (
                                <span><span className={styles.keep}><strong>{groupLabels.get(filterGroup)}</strong>만 보는 중</span> · <strong>{bandName(selectedOutside)}</strong> <span className={styles.keep}>살펴보는 중</span></span>
                            ) : klassItem ? (
                                <span><strong>{groupLabels.get(filterGroup)}</strong> <b aria-hidden="true">›</b> <strong>{klassItem.label}</strong> <span className={styles.keep}>· 항목 {klassItem.count}</span></span>
                            ) : (
                                <span><span className={styles.keep}><strong>{groupLabels.get(filterGroup)}</strong>만 보는 중</span> <span className={styles.keep}>· 항목 {filterCount}</span></span>
                            )}
                            {/* 분모는 띠의 '항목 N'과 같은 기준(작은 제목 점 제외)입니다. 연결 수를 적는 띠에서는 세는 대상이 달라 '점 N개 중'이라고 따로 적습니다. */}
                            {namesMissing && (
                                <span className={styles.keep} role="status">
                                    {relationItem ? ` · 점 ${nameStat.total}개 중 이름 ${nameStat.named}개 표시` : ` · 이름 ${nameStat.named}/${nameStat.total} 표시`}
                                </span>
                            )}
                            </span>
                        </p>
                        {/* 묶음 안의 항목 종류: 누르면 그 종류만 밝힙니다(한 줄, 넘치면 옆으로 넘겨 봅니다) */}
                        {!activeRelation && classList.length > 1 && (
                            <ul className={styles.kinds} aria-label="항목 종류">
                                {classList.map((item) => (
                                    <li key={item.type}>
                                        <button type="button" aria-pressed={activeKlass === item.type} onClick={() => setKlass((prev) => (prev === item.type ? null : item.type))}>
                                            {item.label} <em>{item.count}</em>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <button
                            type="button"
                            className={styles.modeClose}
                            onClick={() => {
                                if (activeRelation) {
                                    setRelation(null);
                                    return;
                                }
                                setPinnedGroup(null);
                                setKlass(null);
                            }}
                        >
                            {activeRelation && filterGroup ? '연결 종류 끄기' : '전체 보기'}
                            <X size={14} aria-hidden="true" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div
                ref={wrapRef}
                className={styles.wrap}
                data-ready={ready ? 'true' : 'false'}
                data-pulling={pulling ? (pulling.touch ? 'touch' : 'mouse') : undefined}
                data-compact={compact ? 'true' : undefined}
                role="group"
                aria-label={label}
                onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch' && engineRef.current) engineRef.current.pointerOn = true;
                }}
                onPointerLeave={(event) => {
                    if (event.pointerType !== 'touch' && engineRef.current) engineRef.current.pointerOn = false;
                }}
                onPointerDownCapture={(event) => {
                    const byTouch = event.pointerType === 'touch';
                    if (byTouch !== touchy) setTouchy(byTouch);
                }}
            >
                {!failed && (
                    <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
                )}
                {/* 캔버스가 그려지기 전(서버가 그린 화면)에 매장 자리에서 숨 쉬는 불빛 */}
                {!failed && (
                    <div className={styles.placeholder} aria-hidden="true">
                        <span />
                    </div>
                )}

                {failed ? (
                    // WebGL2 를 쓸 수 없는 기기: 같은 내용을 묶음별 목록으로 보여 줍니다.
                    <div className={styles.fallback}>
                        <p>이 기기에서는 3D 그래프를 그릴 수 없어 목록으로 보여 드립니다.</p>
                        <ul>
                            {nodes.filter((node) => node.level <= 1 && (node.label || node.full)).map((node) => (
                                <li key={node.id} style={{ '--c': colorOf(node.group).hex }}>
                                    <button type="button" onClick={() => onSelect?.(node)}>
                                        <strong>{node.full || node.label}</strong>
                                        {node.sub && <span>{node.sub}</span>}
                                    </button>
                                    <ul>
                                        {nodes.filter((kid) => kid.parent === node.id && node.level === 1 && (kid.label || kid.full)).map((kid) => (
                                            <li key={kid.id}>
                                                <button type="button" onClick={() => onSelect?.(kid)}>
                                                    {kid.label || kid.full}
                                                    {kid.sub && <span>{kid.sub}</span>}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <>
                        <svg className={styles.leads} aria-hidden="true">
                            {nodes.filter((node) => node.label).map((node) => (
                                <line
                                    key={node.id}
                                    ref={(el) => {
                                        if (el) els.current.leads.set(node.id, el);
                                        else els.current.leads.delete(node.id);
                                    }}
                                />
                            ))}
                            <line
                                className={styles.tether}
                                ref={(el) => {
                                    els.current.tether = el;
                                }}
                            />
                            {/* 고정해 둔 점의 원래 자리(빈 고리)와 지금 자리까지의 선 */}
                            {PIN_SLOTS.map((slot) => (
                                <g
                                    key={`pin-${slot}`}
                                    className={styles.pinMark}
                                    ref={(el) => {
                                        els.current.pins[slot] = el;
                                    }}
                                >
                                    <circle r="5" />
                                    <line />
                                </g>
                            ))}
                        </svg>
                        <div className={styles.labels} aria-hidden="true">
                            {nodes.filter((node) => node.label).map((node) => (
                                <div
                                    key={node.id}
                                    ref={(el) => {
                                        if (el) els.current.labels.set(node.id, el);
                                        else els.current.labels.delete(node.id);
                                    }}
                                    className={styles.label}
                                    data-level={Math.min(3, node.level)}
                                    data-ghost={node.ghost ? 'true' : undefined}
                                    data-note={node.id === peekId ? 'true' : undefined}
                                    style={{ '--c': colorOf(node.group).hex }}
                                >
                                    <b>{node.label}</b>
                                    {node.sub && <span style={TONES[node.subTone] ? { color: TONES[node.subTone] } : undefined}>{node.sub}</span>}
                                </div>
                            ))}
                        </div>
                        {/* 캔버스 안의 점은 키보드·화면 낭독기가 닿지 못하므로, 보이지 않는 버튼을 겹쳐 둡니다.
                            Tab 은 매장과 묶음을 돌고, 화살표는 이어진 점으로 옮겨 가며, Enter·Space 는 살펴보기를 엽니다. Esc 는 그래프 밖으로 나갑니다. */}
                        <ul className={styles.keys}>
                            {nodes.filter((node) => node.label || node.aria || node.full).map((node) => (
                                <li key={node.id}>
                                    <button
                                        type="button"
                                        ref={(el) => {
                                            if (el) els.current.keys.set(node.id, el);
                                            else els.current.keys.delete(node.id);
                                        }}
                                        tabIndex={node.level <= 1 ? 0 : -1}
                                        aria-label={node.aria || [node.full || node.label, node.sub, node.detail].filter(Boolean).join(', ')}
                                        onFocus={() => {
                                            setKeyFocus(node.id);
                                            engineRef.current?.turnTo(node.id);
                                        }}
                                        onBlur={() => setKeyFocus((prev) => (prev === node.id ? null : prev))}
                                        onClick={() => act(node, true)}
                                        onKeyDown={(event) => onKey(event, node)}
                                    />
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {/* 관계 이름표: 고른 점에서 뻗은 연결 묶음마다 하나씩(자리는 스크립트가 잡습니다) */}
                {!failed && (
                    <div className={styles.labels} aria-hidden="true">
                        {TAG_SLOTS.map((slot) => (
                            <span
                                key={slot}
                                ref={(el) => {
                                    els.current.tags[slot] = el;
                                }}
                                className={styles.tag}
                            />
                        ))}
                        <span
                            ref={(el) => {
                                els.current.more = el;
                            }}
                            className={`${styles.tag} ${styles.tagMore}`}
                        />
                    </div>
                )}

                {/* 손가락으로 당기기: 고른 점에 뜨는 고리 손잡이. 여기서 시작한 끌기는 기다림 없이 바로 그 점을 당깁니다. */}
                {!failed && live && touchy && selectedNode && !selectedNode.ghost && (
                    <span
                        ref={(el) => {
                            els.current.handle = el;
                        }}
                        className={styles.handle}
                        aria-hidden="true"
                        onPointerDown={(event) => gesturesRef.current?.pullFrom(event.nativeEvent, selectedNode.id, event.currentTarget)}
                    />
                )}
                {/* 손가락으로 당기는 동안: 손가락 둘레의 가는 고리와, 손가락에 가리지 않게 무대 맨 위에 쓰는 점 이름 */}
                {!failed && (
                    <span
                        ref={(el) => {
                            els.current.ring = el;
                        }}
                        className={styles.touchRing}
                        data-on={pulling?.touch ? 'true' : 'false'}
                        aria-hidden="true"
                    />
                )}
                {!failed && heldNode && (pulling?.touch || afterPull) && (
                    <p className={styles.pullName} aria-hidden="true">
                        <i style={{ '--c': colorOf(heldNode.group).hex }} />
                        <strong>{heldNode.full || heldNode.label}</strong>
                        {heldNode.sub && <span>{heldNode.sub}</span>}
                    </p>
                )}

                {!failed && (
                    <div ref={toolsRef} className={styles.tools} role="group" aria-label="그래프 보기 조절">
                        <button type="button" onClick={() => zoom(1.3)} aria-label="확대" title="확대 (⌘/Ctrl + 휠)">
                            <Plus size={16} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="축소" title="축소">
                            <Minus size={16} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={reset} aria-label="처음 보기로" title="처음 보기로" data-on={turned || filtering || pins > 0 ? 'true' : 'false'}>
                            <RotateCcw size={15} aria-hidden="true" />
                        </button>
                    </div>
                )}

                {/* 연결 종류: 하나를 고르면 그 연결만 밝아집니다. 선 무늬는 연결의 갈래(근거·경쟁·할 일 …)를 뜻합니다.
                    확대 단추 옆(왼쪽 아래)에 두어 살펴보기 카드에 가려지지 않습니다. */}
                {!failed && live && (relationList.length > 0 || pins > 0) && (
                    <div ref={dockRef} className={styles.relations}>
                        {relOpen && relationList.length > 0 && (
                            <div className={styles.relationList} role="group" aria-label="연결 종류">
                                <p className={styles.relationHelp}>연결 종류를 고르면 그 연결만 밝게 보입니다.</p>
                                <div className={styles.relationCols}>
                                    {relationFamilies.map((family) => (
                                        <section key={`${family.label}-${family.quiet}`} data-quiet={family.quiet ? 'true' : undefined}>
                                            <p>{family.label}</p>
                                            <ul>
                                                {family.items.map((item) => (
                                                    <li key={item.rel}>
                                                        <button type="button" aria-pressed={activeRelation === item.rel} data-family={item.family} onClick={() => chooseRelation(item.rel)}>
                                                            <i aria-hidden="true" />
                                                            <span>{item.name}</span>
                                                            <em>{item.count}</em>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    ))}
                                </div>
                            </div>
                        )}
                        {relationList.length > 0 && (
                            <button type="button" className={styles.relationToggle} aria-expanded={relOpen} onClick={() => setRelOpen((prev) => !prev)}>
                                연결 종류 <em>{relationList.length}</em>
                            </button>
                        )}
                        {pins > 0 && (
                            <button type="button" className={styles.pinned} onClick={unpin}>
                                고정 <em>{pins}</em> · 모두 풀기
                            </button>
                        )}
                    </div>
                )}

                <AnimatePresence>
                    {selectedNode && (
                        <motion.div
                            key="inspector"
                            ref={inspectorRef}
                            className={`${styles.inspectorSlot} ${styles.inspector}`}
                            data-sheet={sheet ? 'true' : 'false'}
                            data-collapsed={pulling?.touch ? 'true' : 'false'}
                            initial={sheet ? { y: '100%' } : { opacity: 0, x: 14 }}
                            animate={sheet ? { y: 0 } : { opacity: 1, x: 0 }}
                            exit={sheet ? { y: '100%' } : { opacity: 0, x: 14 }}
                            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <Inspector
                                node={selectedNode}
                                links={links}
                                nodeById={nodeById}
                                ontology={ontology}
                                groupNames={groupLabels}
                                origin={picked?.origin || null}
                                sheet={sheet}
                                collapsed={Boolean(pulling?.touch)}
                                focusOnOpen={Boolean(picked?.byKey)}
                                onJump={(id, origin) => inspect(id, origin, Boolean(picked?.byKey))}
                                onGo={(node) => onSelect?.(node)}
                                onClose={close}
                                onLinkHover={(id) => {
                                    engineRef.current?.setLinkHot(id);
                                    engineRef.current?.invalidate?.();
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
                {children}
            </div>

            <p className={styles.readout} data-on={readNode || pullNode ? 'true' : 'false'}>
                {pullNode ? (
                    <>
                        <i className={styles.readoutDot} style={{ '--c': colorOf(pullNode.group).hex }} aria-hidden="true" />
                        <strong>{pullNode.full || pullNode.label}</strong>
                        <span className={styles.readoutText}>당기는 중 · 놓으면 제자리로{pulling.touch ? '' : ' · Shift 누른 채 놓으면 고정'}</span>
                    </>
                ) : readNode && peekShown ? (
                    // 톡 해서 이름(쪽지)만 띄운 동안: 이 줄 전체가 그 항목의 카드를 여는 단추입니다(쪽지를 한 번 더 눌러도 같음).
                    <button
                        type="button"
                        className={styles.readoutPeek}
                        onClick={() => {
                            const id = readNode.id;
                            setPeek(null);
                            if (live && nodeById.has(id)) inspect(id);
                        }}
                    >
                        <i className={styles.readoutDot} style={{ '--c': colorOf(readNode.group).hex }} aria-hidden="true" />
                        <strong>{readNode.label || readNode.full}</strong>
                        {readNode.sub && <span className={styles.readoutValue}>{readNode.sub}</span>}
                        <span className={styles.readoutText}>이 줄이나 이름을 누르면 살펴봅니다</span>
                    </button>
                ) : readNode ? (
                    <>
                        <i className={styles.readoutDot} style={{ '--c': colorOf(readNode.group).hex }} aria-hidden="true" />
                        <strong>{readNode.full || readNode.label}</strong>
                        {/* 이름 · 값 — 설명 (값은 이름표의 sub 와 같은 글자) */}
                        {readNode.sub && <span className={styles.readoutValue}>{readNode.sub}</span>}
                        {readNode.detail && <span className={styles.readoutText}>{readNode.detail}</span>}
                    </>
                ) : emptyGroup ? (
                    // 흐리게 둔(항목 없는) 범례 단추를 누르면, 폰에서는 title 이 안 보이므로 이 줄에 이유를 잠깐 보여 줍니다.
                    <span className={styles.readoutHint} role="status">{groupLabels.get(emptyGroup) || '이'}: 이 묶음에는 따로 살펴볼 항목이 없습니다.</span>
                ) : live ? (
                    <span className={styles.readoutHint}>{guide}</span>
                ) : (
                    <span className={styles.readoutHint}>{hint}</span>
                )}
            </p>
            {/* Esc 로 그래프에서 나왔을 때 초점이 놓이는 자리(다음 Tab 이 그래프 뒤로 이어집니다) */}
            <span ref={exitRef} tabIndex={-1} className={styles.exit} aria-label="그래프 끝" />
        </div>
    );
});

export default PlaceGraph;
