'use client';

// 그래프에서 고른 점을 살펴보는 카드.
// 위에는 무엇의 카드인지(묶음·이름·핵심 값), 아래에는 본문으로 가는 버튼이 늘 보이고, 가운데만 스크롤됩니다.
// 가운데는 '연결된 항목'이 먼저입니다(열자마자 첫 묶음이 보이게). 그 점의 수치와 설명 문장은 그 뒤에 옵니다.
// '연결된 항목'은 두 가지로 봅니다.
//   이름만    조각으로 모아 보고, 조각에 올리면(또는 Tab 으로 가면) 이어진 이유가 버튼 위의 고정 칸에 나옵니다.
//   이유 함께 줄마다 이름·값·이유 문장을 펼쳐 봅니다(손가락으로 누르는 화면의 기본).
// 어느 쪽이든 항목을 누르면 그 점으로 건너가고, 건너간 카드에는 '방금 건너온 연결'이 맨 앞에 표시됩니다.
// 카드에 넣을 내용(묶음 제목·순서·겹치는 값 정리)은 card-model.js 가 만듭니다.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, ChevronRight, X } from 'lucide-react';
import styles from './Inspector.module.css';
import { colorOf, TONES } from './palette';
import { buildCardModel } from './card-model';

const NUMBER = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/;
// 줄 끝에서 줄어들지 않는 빈칸(굴리는 숫자 앞뒤의 띄어쓰기를 지킵니다)
const NBSP = String.fromCharCode(160);
// 작은 글자에는 상태 색(좋음·주의·나쁨)만 씁니다. 흐린 회색 상태는 읽기 어려워 기본 글자색으로 둡니다.
const STATUS = new Set(['good', 'warn', 'bad']);
const NO_FOLDS = new Set();
// 아래 시트의 자리가 이보다 낮으면(px) 머리에서 묶음·종류 줄을 빼 본문 자리를 넓힙니다.
const TIGHT_SHEET = 300;
// 사용자가 고른 보기 방식은 카드를 닫았다 열어도 이어집니다(페이지를 떠나면 잊음).
let rememberedView = null;

// 숫자 앞뒤의 띄어쓰기가 줄어들지 않게 합니다('키워드 4개 상위'가 '키워드4개 상위'로 붙지 않도록).
function keepEdges(part) {
    return part.replace(/^\s+|\s+$/g, (gap) => NBSP.repeat(gap.length));
}

// 숫자를 자릿수마다 굴려서 보여 줍니다. 쉼표는 제자리로 톡 뛰어 들어옵니다. 숫자가 아닌 값은 그대로 씁니다.
function Rolling({ value }) {
    const text = typeof value === 'number' ? value.toLocaleString('ko-KR') : String(value ?? '');
    const match = text.match(NUMBER);
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        const raf = requestAnimationFrame(() => setArmed(true));
        return () => cancelAnimationFrame(raf);
    }, []);
    if (!match) return <span>{text}</span>;
    const [, before, digits, after] = match;
    const count = digits.replace(/\D/g, '').length;
    let nth = 0;
    return (
        <span className={styles.rolling}>
            <span className={styles.srOnly}>{text}</span>
            {before && <span aria-hidden="true">{keepEdges(before)}</span>}
            {[...digits].map((char, index) => {
                if (!/\d/.test(char)) {
                    return <span key={index} className={styles.rollMark} style={{ '--i': nth }} aria-hidden="true">{char}</span>;
                }
                const order = count - 1 - nth;
                nth += 1;
                return (
                    <span key={index} className={styles.rollDigit} aria-hidden="true">
                        <span style={{ '--d': armed ? Number(char) : 0, '--i': order }}>0123456789</span>
                    </span>
                );
            })}
            {after && <span aria-hidden="true">{keepEdges(after)}</span>}
        </span>
    );
}

// 누르는 조각 위에서 포인터를 따라다니는 옅은 빛(묶음 색)
function trackPointer(event) {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`);
}

// 누른 항목의 이름이 있던 자리(카드 제목이 거기서 날아옵니다)
function originOf(button) {
    const box = (button.querySelector('[data-name]') || button).getBoundingClientRect();
    return { x: box.left, y: box.top, h: box.height };
}

function toneColor(tone) {
    return STATUS.has(tone) ? TONES[tone] : undefined;
}

// 스크롤 상자(root) 안에서 el 의 윗변 자리(스크롤·움직임 효과와 상관없는 배치 값)
function offsetWithin(el, root) {
    let top = 0;
    for (let at = el; at && at !== root; at = at.offsetParent) top += at.offsetTop;
    return top;
}

// 연결 한 건의 구조: 주어 › 술어 › 목적어. 평문 이유 문장을 돕는 작은 줄입니다(이름이 정해진 한 건에만 씁니다).
function Triple({ triple, className }) {
    const Mark = triple.symmetric ? ArrowLeftRight : ChevronRight;
    return (
        <span className={className ? `${styles.triple} ${className}` : styles.triple}>
            <span>{triple.subject}</span>
            {/* 꺾쇠는 뒤따르는 말과 한 덩어리로 줄을 바꿉니다(줄 끝에 꺾쇠만 남지 않게). */}
            <span className={styles.tripleStep}>
                <Mark size={12} aria-hidden="true" />
                <b>{triple.predicate}</b>
            </span>
            <span className={styles.tripleStep}>
                <Mark size={12} aria-hidden="true" />
                <span>{triple.object}</span>
            </span>
        </span>
    );
}

// 항목에 붙는 값(그 연결의 값, 없으면 상대 점의 핵심 값). 이름도 값도 같은 다른 점이 있으면 종류 이름을 덧붙입니다.
function Badge({ item }) {
    if (!item.badge && !item.hint) return null;
    return (
        <em className={styles.badge}>
            {item.badge && <span style={toneColor(item.badgeTone) ? { color: toneColor(item.badgeTone) } : undefined}>{item.badge}</span>}
            {item.badge && item.hint ? ' · ' : ''}
            {item.hint}
        </em>
    );
}

// node: 고른 점 · links·nodeById·ontology·groupNames: 그래프 전체(카드 내용을 여기서 골라 냅니다)
// origin: 점 이름표(또는 누른 항목)가 있던 화면 자리 · sheet: 좁은 화면의 아래 시트
// collapsed: 제목 한 줄로 접기(고른 점을 손가락으로 끄는 동안 그래프를 가리지 않게). 풀면 보던 자리 그대로 펼쳐집니다.
// neighbors·groupName 은 예전 방식으로 부를 때만 씁니다.
export default function Inspector({
    node, links, nodeById, ontology, groupNames, origin, sheet, collapsed = false, onJump, onGo, onClose, onLinkHover, focusOnOpen, neighbors, groupName,
}) {
    const rootRef = useRef(null);
    const titleRef = useRef(null);
    const bodyRef = useRef(null);
    const innerRef = useRef(null);
    const fixRef = useRef(null);
    const stripRef = useRef(null);
    const stripWas = useRef({ id: '', active: false, height: 0, raf: 0 });
    const hushUntil = useRef(0);
    const maxRef = useRef(0);
    const hoverRef = useRef(onLinkHover);
    hoverRef.current = onLinkHover;
    const collapsedRef = useRef(collapsed);
    collapsedRef.current = collapsed;

    const [canHover] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(hover: hover)').matches);
    const [choice, setChoice] = useState(rememberedView);
    const [trail, setTrail] = useState({ id: node.id, linkId: null });
    const [intent, setIntent] = useState(null);
    const [current, setCurrent] = useState(null);
    const [unfolded, setUnfolded] = useState(NO_FOLDS);
    // 카드가 쓸 수 있는 자리의 높이(px). 엔진이 정한 자리(부모)를 잽니다.
    const [slotH, setSlotH] = useState(0);
    // 본문 창의 높이(px). 머리·버튼의 높이가 늦게 바뀌어도(글꼴이 늦게 오는 등) 첫 묶음이 보이는지 다시 보려고 둡니다.
    const [bodyH, setBodyH] = useState(0);
    // 열자마자 첫 묶음이 보이도록 한 단계씩 줄인 정도(아래 steps 참고)
    const [fit, setFit] = useState({ key: '', level: 0 });

    // 다른 점으로 넘어가면: 항목을 눌러 건너온 것이면 그 연결을 기억하고, 나머지 상태는 처음으로 돌립니다.
    if (trail.id !== node.id) {
        setTrail({ id: node.id, linkId: intent && intent.to === node.id ? intent.linkId : null });
        setIntent(null);
        setCurrent(null);
        setUnfolded(NO_FOLDS);
    }
    const viaLinkId = trail.id === node.id ? trail.linkId : null;

    const graph = useMemo(() => {
        if (links && nodeById) return { links, nodeById, groupNames };
        const list = neighbors || [];
        return {
            links: list.map((entry) => entry.link),
            nodeById: new Map([[node.id, node], ...list.map((entry) => [entry.node.id, entry.node])]),
            groupNames: groupNames || { [node.group]: groupName },
        };
    }, [links, nodeById, groupNames, neighbors, node, groupName]);

    const model = useMemo(
        () => buildCardModel({ node, links: graph.links, nodeById: graph.nodeById, ontology, groupNames: graph.groupNames, via: viaLinkId ? { linkId: viaLinkId } : null }),
        [node, graph, ontology, viaLinkId],
    );
    const color = colorOf(node.group);
    const eyebrow = [model.groupName, model.kindName].filter(Boolean);
    const restLink = model.via ? model.via.item.linkId : null;
    const hasGroups = model.groups.some((group) => !group.quiet);
    const touchLike = sheet || !canHover;
    const tight = sheet && slotH > 0 && slotH < TIGHT_SHEET;

    // 설명 문장이 곧 본문인 점(할 일의 안내, AI 점검의 근거, AI 질문의 답 — 숫자가 들어 있거나, 값·수치가 따로 없는 점).
    // 값을 풀이하는 한 문장('…한 순서입니다')은 언제나 연결된 항목과 수치 뒤에 둡니다.
    const detailIsBody = Boolean(model.detail) && (!(model.value || model.facts.length) || /\d/.test(model.detail));
    // 열자마자 첫 묶음(제목 + 첫 줄)이 보여야 합니다. 안 보이면 아래 순서로 하나씩 줄입니다(자리나 점이 바뀌면 처음부터 다시 봅니다).
    //   detail  본문인 설명 문장을 연결된 항목 뒤로 보냄
    //   chips   손가락 화면의 기본인 '이유 함께'(줄)를 '이름만'(조각)으로 — 사용자가 보기 방식을 직접 고른 뒤에는 건드리지 않음
    //   snug    아래 시트에서 머리·버튼의 여백과 묶음 사이를 줄임(누르는 크기는 그대로)
    const steps = [];
    if (hasGroups && detailIsBody) steps.push('detail');
    if (hasGroups && touchLike && !choice) steps.push('chips');
    if (hasGroups && sheet) steps.push('snug');
    const fitKey = `${node.id}|${slotH}|${sheet ? 'sheet' : 'side'}|${choice || ''}`;
    const level = fit.key === fitKey ? Math.min(fit.level, steps.length) : 0;
    const applied = steps.slice(0, level);
    const detailTop = Boolean(model.detail) && (!hasGroups || (detailIsBody && !applied.includes('detail')));

    // 기본 보기: 손가락으로 누르는 화면과 연결이 몇 개 안 되는 카드는 이유를 펼쳐서, 나머지는 조각으로.
    const autoView = touchLike ? (applied.includes('chips') ? 'chips' : 'list') : (model.total <= 4 ? 'list' : 'chips');
    const view = choice || autoView;

    // 그래프의 이름표가 카드 제목 자리로 날아와 앉습니다(같은 것이 옮겨 왔다는 것을 눈으로 따라갈 수 있게).
    useLayoutEffect(() => {
        const target = titleRef.current;
        if (!target || !origin || sheet) return undefined;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !target.animate) return undefined;
        const to = target.getBoundingClientRect();
        const scale = Math.min(1, Math.max(0.5, origin.h / Math.max(1, to.height)));
        const flight = target.animate([
            { transform: `translate(${origin.x - to.left}px, ${origin.y - to.top}px) scale(${scale})`, opacity: 0.85 },
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ], { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        return () => flight.cancel();
    }, [node.id, origin, sheet]);

    useEffect(() => {
        if (focusOnOpen) rootRef.current?.focus({ preventScroll: true });
    }, [focusOnOpen, node.id]);

    // 자리(부모)의 높이를 재고, 본문 상자의 높이가 정수 px 이 되도록 카드의 최대 높이를 맞춥니다.
    // 본문 상자나 내용의 높이에 소수점이 남으면, 본문을 끝까지 내린 뒤 한 번 더 쓸어야 페이지가 넘어갑니다
    // (브라우저의 합성 쪽 스크롤 끝이 화면 쪽보다 소수점만큼 더 남아, 그 손짓이 본문에 묶이기 때문).
    useLayoutEffect(() => {
        const card = rootRef.current;
        const slot = card ? card.parentElement : null;
        const body = bodyRef.current;
        if (!card || !slot) return undefined;
        const measure = () => {
            if (collapsedRef.current) return;
            const room = slot.getBoundingClientRect().height;
            if (!(room > 0)) return;
            setSlotH(Math.floor(room));
            if (!body) return;
            setBodyH(body.clientHeight);
            // 머리·이유 칸·버튼이 차지하는 높이(카드 − 본문). 최대 높이를 바꿔도 이 값은 그대로라 되돌이가 없습니다.
            const fixed = card.getBoundingClientRect().height - body.getBoundingClientRect().height;
            const best = Math.floor(room - fixed + 0.01) + fixed;
            if (best > 0 && Math.abs(best - maxRef.current) > 0.02) {
                maxRef.current = best;
                card.style.maxHeight = `${best}px`;
            }
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        // 크기가 바뀐 알림 안에서 카드 높이를 다시 쓰면, 같은 프레임에 또 크기가 바뀌어 브라우저가
        // 'ResizeObserver loop completed with undelivered notifications' 경고를 냅니다. 다음 프레임으로 미룹니다.
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        });
        observer.observe(slot);
        observer.observe(card);
        if (body) observer.observe(body);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [node.id]);

    // 본문 내용의 높이도 정수 px 로 맞춥니다(모자란 소수점만큼 끝에 덧댐).
    useLayoutEffect(() => {
        const inner = innerRef.current;
        const fix = fixRef.current;
        if (!inner || !fix) return undefined;
        let pad = -1;
        const snap = () => {
            const height = inner.getBoundingClientRect().height;
            const rest = height - Math.floor(height);
            const next = rest > 0.01 && rest < 0.99 ? 1 - rest : 0;
            if (Math.abs(next - pad) > 0.005) {
                pad = next;
                fix.style.height = `${next}px`;
            }
        };
        snap();
        if (typeof ResizeObserver === 'undefined') return undefined;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(snap);
        });
        observer.observe(inner);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [node.id]);

    // 본문이 끝(또는 처음)에 닿아 있을 때 그 방향으로 쓸면 페이지가 이어서 넘어가야 합니다. 보통은 브라우저가 알아서 넘기지만,
    // 직전의 튕김 스크롤에 손짓이 묶이면 본문도 페이지도 움직이지 않습니다. 그때만 손가락이 움직인 만큼 페이지를 직접 넘깁니다.
    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return undefined;
        let swipe = null;
        const start = (event) => {
            if (event.touches.length !== 1) {
                swipe = null;
                return;
            }
            const touch = event.touches[0];
            const max = body.scrollHeight - body.clientHeight;
            swipe = { x: touch.clientX, y: touch.clientY, t: performance.now(), page: window.scrollY, top: body.scrollTop, atEnd: body.scrollTop >= max - 1, atStart: body.scrollTop <= 1, mode: '' };
        };
        const move = (event) => {
            if (!swipe || event.touches.length !== 1) return;
            const touch = event.touches[0];
            // 양수: 손가락이 위로 간 거리(아래 내용을 보려는 손짓)
            const owed = swipe.y - touch.clientY;
            if (!swipe.mode) {
                if (Math.abs(owed) < 6 || Math.abs(touch.clientX - swipe.x) > Math.abs(owed)) return;
                const stuck = (owed > 0 && swipe.atEnd) || (owed < 0 && swipe.atStart);
                // 본문이 스스로 넘어갈 수 있는 방향이거나, 이미 브라우저가 본문·페이지를 움직였으면 손대지 않습니다.
                if (!stuck || Math.abs(window.scrollY - swipe.page) > 2 || Math.abs(body.scrollTop - swipe.top) > 2) {
                    swipe.mode = 'native';
                    return;
                }
                if (Math.abs(owed) < 30 || performance.now() - swipe.t < 120) return;
                swipe.mode = 'assist';
            }
            if (swipe.mode === 'assist') window.scrollTo(0, swipe.page + owed);
        };
        const end = () => {
            swipe = null;
        };
        const passive = { passive: true };
        body.addEventListener('touchstart', start, passive);
        body.addEventListener('touchmove', move, passive);
        body.addEventListener('touchend', end, passive);
        body.addEventListener('touchcancel', end, passive);
        return () => {
            body.removeEventListener('touchstart', start);
            body.removeEventListener('touchmove', move);
            body.removeEventListener('touchend', end);
            body.removeEventListener('touchcancel', end);
        };
    }, [node.id]);

    // 열자마자 첫 묶음의 첫 줄이 본문 창 안에 다 들어오는지 봅니다. 안 들어오면 한 단계 줄입니다(위 steps).
    // 조각을 가리켜 이유 칸이 올라온 동안에는 줄이지 않습니다(보던 내용이 갑자기 자리를 바꾸지 않게).
    const stepCount = steps.length;
    const pointing = Boolean(current);
    useLayoutEffect(() => {
        if (!hasGroups || collapsed || pointing || !slotH || level >= stepCount) return;
        const card = rootRef.current;
        const body = bodyRef.current;
        if (!card || !card.parentElement || !body || body.scrollTop > 0) return;
        const first = body.querySelector('[data-group] button');
        if (!first) return;
        // 본문 창의 높이는 자리에서 머리·이유 칸·버튼을 빼서 셉니다(접었다 펴는 동안 잠깐 줄어든 본문 높이에 속지 않게).
        let room = Math.floor(card.parentElement.getBoundingClientRect().height) - (card.offsetHeight - card.clientHeight) - card.firstElementChild.offsetHeight;
        for (const part of body.parentElement.children) {
            if (part !== body) room -= part.offsetHeight;
        }
        // '방금 건너온 연결' 줄은 꼬리표와 세 마디 줄이 붙어 길므로, 이유 문장까지 보이면 보이는 것으로 칩니다(건너올 때마다 보기 방식이 바뀌지 않게).
        const upTo = (first.dataset.via && first.querySelector('[data-why]')) || first;
        if (offsetWithin(upTo, body) + upTo.offsetHeight <= room) return;
        setFit({ key: fitKey, level: level + 1 });
    }, [hasGroups, collapsed, pointing, slotH, bodyH, level, stepCount, fitKey]);

    // 아래 시트가 화면 밖이나 화면 아래에 고정된 메뉴 밑에 가리면(그래프 칸이 화면보다 아래로 넘칠 때) 가린 만큼만 페이지를 올립니다.
    // 시트는 그래프 칸의 아래 끝에 붙어 있으므로 칸의 아래 끝으로 잽니다(올라오는 동안의 시트 자리는 재지 않음).
    useEffect(() => {
        if (!sheet) return undefined;
        const slot = rootRef.current?.parentElement;
        const stage = slot ? slot.offsetParent || slot.parentElement : null;
        if (!stage) return undefined;
        const raf = requestAnimationFrame(() => {
            let limit = window.innerHeight;
            for (let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 2); el && el !== document.body; el = el.parentElement) {
                if (getComputedStyle(el).position === 'fixed') {
                    limit = Math.min(limit, el.getBoundingClientRect().top);
                    break;
                }
            }
            const hidden = stage.getBoundingClientRect().bottom - (limit - 8);
            if (hidden > 1 && hidden < window.innerHeight) {
                const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                window.scrollBy({ top: hidden, behavior: calm ? 'auto' : 'smooth' });
            }
        });
        return () => cancelAnimationFrame(raf);
    }, [sheet, node.id]);

    // 건너온 뒤에는 그 연결의 선을 그래프에서 밝혀 둡니다.
    useEffect(() => {
        hoverRef.current?.(restLink);
    }, [node.id, restLink]);

    const jump = (item, button) => {
        setIntent({ linkId: item.linkId, to: item.id });
        onJump(item.id, originOf(button));
    };
    // 조각 보기: 마지막으로 가리킨 항목의 이유가 고정 칸에 남습니다(포인터가 떠나도, 스크롤해도 사라지지 않음).
    const explain = (item) => {
        setCurrent(item.key);
        onLinkHover(item.linkId);
    };
    // 줄 보기: 올린 줄의 선만 그래프에서 밝힙니다.
    const light = (item) => onLinkHover(item.linkId);
    const unlight = () => onLinkHover(restLink);
    const choose = (next) => {
        rememberedView = next;
        setChoice(next);
        setCurrent(null);
        onLinkHover(restLink);
    };
    const toggleFold = (key) => {
        setUnfolded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const shown = model.groups.filter((group) => !group.quiet || unfolded.has(group.key));
    const shownItems = shown.flatMap((group) => group.items.map((item) => ({ item, group })));
    const active = view === 'chips' && current ? shownItems.find((entry) => entry.item.key === current) || null : null;
    // 이유 칸(고정): 조각을 가리키고 있을 때와, 방금 건너온 연결을 알릴 때만 있습니다. 평소에는 없어서 연결된 항목이 그만큼 더 보입니다.
    const showStrip = view === 'chips' && canHover && Boolean(active || model.via);
    // 칸이 생기면 높이는 이 카드에서 가장 긴 이유 문장에 맞춥니다(조각을 옮겨 가도 칸이 출렁이지 않게 모두 겹쳐 놓고 하나만 보임).
    const notes = active ? shownItems : [];
    const activeKey = active ? active.item.key : null;

    // 이유 칸이 생기거나 커지는 순간: 그만큼 본문 아래가 줄어듭니다.
    // 가리킨 조각이 그 밑으로 들어가면 칸이 올라오는 것과 같은 걸음으로 본문을 밀어 올려, 조각이 이유 칸 바로 위에 남게 합니다.
    useLayoutEffect(() => {
        const strip = stripRef.current;
        const was = stripWas.current;
        const sameCard = was.id === node.id;
        if (!sameCard) {
            cancelAnimationFrame(was.raf || 0);
            if (strip) strip.style.height = '';
            hushUntil.current = 0;
        }
        const height = strip ? strip.offsetHeight : 0;
        const grew = Boolean(strip) && sameCard && Boolean(activeKey) && !was.active && height > was.height + 1;
        stripWas.current = { id: node.id, active: Boolean(activeKey), height, raf: sameCard ? was.raf : 0 };
        if (!grew) return;
        const body = bodyRef.current;
        const chip = body ? body.querySelector('[data-current="true"]') : null;
        const over = chip ? Math.max(0, chip.getBoundingClientRect().bottom + 6 - body.getBoundingClientRect().bottom) : 0;
        const startTop = body ? body.scrollTop : 0;
        // 조각이 포인터 밑에서 비켜나므로, 잠깐은 포인터 밑에 새로 온 조각으로 바꾸지 않습니다.
        if (over > 0) hushUntil.current = performance.now() + 380;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            if (body) body.scrollTop = startTop + over;
            return;
        }
        const from = was.height;
        const began = performance.now();
        strip.style.height = `${from}px`;
        const step = (now) => {
            const t = Math.min(1, (now - began) / 220);
            const eased = 1 - (1 - t) ** 3;
            strip.style.height = `${from + (height - from) * eased}px`;
            if (body && body.isConnected) body.scrollTop = startTop + over * eased;
            if (t < 1) stripWas.current.raf = requestAnimationFrame(step);
            else strip.style.height = '';
        };
        cancelAnimationFrame(was.raf || 0);
        stripWas.current.raf = requestAnimationFrame(step);
    });

    useEffect(() => () => cancelAnimationFrame(stripWas.current.raf || 0), []);

    let order = 0;

    const renderItem = (item) => {
        const tint = colorOf(item.group);
        const style = { '--c': tint.hex, '--cv': tint.vividHex };
        if (view === 'list') {
            const note = item.why || item.about;
            return (
                <button
                    type="button"
                    className={styles.row}
                    style={style}
                    data-via={item.via ? 'true' : undefined}
                    onClick={(event) => jump(item, event.currentTarget)}
                    onPointerEnter={(event) => {
                        if (event.pointerType !== 'touch') light(item);
                    }}
                    onPointerLeave={unlight}
                    onFocus={(event) => {
                        if (event.currentTarget.matches(':focus-visible')) light(item);
                    }}
                    onBlur={unlight}
                >
                    {item.via && <span className={styles.rowTag}>방금 건너온 연결</span>}
                    <span className={styles.rowTop}>
                        <i aria-hidden="true" />
                        <strong data-name>{item.name}</strong>
                        <Badge item={item} />
                    </span>
                    {note && <span className={styles.rowWhy} data-why>{note}</span>}
                    {item.via && item.triple && <Triple triple={item.triple} className={styles.rowTriple} />}
                </button>
            );
        }
        return (
            <button
                type="button"
                className={styles.chip}
                style={style}
                title={item.full && item.full !== item.label ? item.full : undefined}
                data-current={activeKey === item.key ? 'true' : undefined}
                data-via={item.via ? 'true' : undefined}
                onClick={(event) => jump(item, event.currentTarget)}
                onPointerMove={trackPointer}
                onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch' && performance.now() >= hushUntil.current) explain(item);
                }}
                onFocus={(event) => {
                    if (event.currentTarget.matches(':focus-visible')) explain(item);
                }}
            >
                <i aria-hidden="true" />
                {item.lead && <Badge item={item} />}
                <span className={styles.chipName} data-name>{item.label}</span>
                {!item.lead && <Badge item={item} />}
            </button>
        );
    };

    // 방금 건너온 연결: 어디서 왔고(주어 › 술어 › 목적어) 왜 이어졌는지
    const viaNote = model.via ? (
        <>
            <p className={styles.noteTag}>방금 건너온 연결</p>
            {model.via.item.triple && <p className={styles.noteHead}><Triple triple={model.via.item.triple} /></p>}
            <p className={styles.noteText}>{model.via.item.why || model.via.item.about || `${model.via.item.name} · ${model.via.title}`}</p>
        </>
    ) : null;

    const renderList = (group) => (
        <ul className={view === 'list' ? styles.rows : styles.chips}>
            {group.items.map((item) => {
                order += 1;
                return <li key={item.key} style={{ '--n': order }}>{renderItem(item)}</li>;
            })}
        </ul>
    );

    // 이 점의 수치(큰 값을 다시 적은 것은 card-model 이 이미 뺐습니다)
    const facts = model.facts.length > 0 ? (
        <dl className={styles.facts}>
            {model.facts.map((fact, index) => (
                <div key={`${fact.label}-${index}`} style={{ '--n': index }}>
                    <dt>{fact.label}</dt>
                    <dd style={toneColor(fact.tone) ? { color: toneColor(fact.tone) } : undefined}><Rolling value={fact.value} /></dd>
                </div>
            ))}
        </dl>
    ) : null;

    const linked = model.total > 0 ? (
        <section className={styles.linked} aria-label="연결된 항목">
            <div className={styles.linkedHead}>
                <h4>연결된 항목 <span>{model.total}</span></h4>
                <div className={styles.views} role="group" aria-label="연결된 항목 보기 방식">
                    <button type="button" aria-pressed={view === 'chips'} onClick={() => choose('chips')}>이름만</button>
                    <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>이유 함께</button>
                </div>
            </div>

            {model.groups.map((group, index) => {
                if (group.quiet) {
                    // 구조 관계('속한 곳')는 맨 아래에 접어 둡니다.
                    const open = unfolded.has(group.key);
                    return (
                        <div key={group.key} className={styles.fold} data-open={open ? 'true' : 'false'}>
                            <button type="button" className={styles.foldToggle} aria-expanded={open} onClick={() => toggleFold(group.key)}>
                                <ChevronRight size={14} aria-hidden="true" />
                                {group.title}
                                <span>{group.items.length}</span>
                            </button>
                            {open && renderList(group)}
                        </div>
                    );
                }
                return (
                    <div key={group.key} className={styles.group} data-group>
                        <h5>{group.title} <span>{group.items.length}</span></h5>
                        {renderList(group)}
                        {/* 올릴 수 없는 화면(손가락)의 조각 보기: 건너온 연결의 이유를 그 조각이 든 묶음 바로 아래에 둡니다. */}
                        {index === 0 && view === 'chips' && !canHover && viaNote && <div className={styles.inlineNote}>{viaNote}</div>}
                    </div>
                );
            })}
        </section>
    ) : null;

    return (
        <aside
            ref={rootRef}
            className={styles.card}
            data-sheet={sheet ? 'true' : 'false'}
            data-view={view}
            data-collapsed={collapsed ? 'true' : 'false'}
            data-tight={tight ? 'true' : undefined}
            data-snug={applied.includes('snug') ? 'true' : undefined}
            style={{ '--c': color.hex, '--cv': color.vividHex }}
            tabIndex={-1}
            role="region"
            aria-label={`${model.title} 살펴보기`}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    onClose(true);
                }
            }}
        >
            {/* 스크롤해도 남는 머리: 묶음 · 종류, 이름, 핵심 값 */}
            <header className={styles.head}>
                <div className={styles.headText} data-mark={eyebrow.length && !tight ? undefined : 'true'}>
                    {/* 묶음 · 종류. 제목이 곧 묶음 이름인 점과 자리가 낮은 시트에서는 이 줄을 빼고 왼쪽에 묶음 색 줄만 긋습니다. */}
                    {eyebrow.length > 0 && !tight && (
                        <p className={styles.eyebrow}>
                            <i aria-hidden="true" />
                            {eyebrow[0]}
                            {eyebrow[1] && <span>{eyebrow[1]}</span>}
                        </p>
                    )}
                    <div className={styles.heading}>
                        <h3 ref={titleRef} className={styles.title} data-long={model.title.length > 22 ? 'true' : undefined}>{model.title}</h3>
                        {model.value && (
                            <p className={styles.value} style={TONES[model.valueTone] ? { color: TONES[model.valueTone] } : undefined}>
                                <Rolling key={node.id} value={model.value} />
                            </p>
                        )}
                    </div>
                </div>
                <button type="button" className={styles.close} onClick={() => onClose(false)} aria-label="살펴보기 닫기">
                    <X size={16} aria-hidden="true" />
                </button>
            </header>

            {/* 머리 아래 전부: 접으면(collapsed) 높이가 0 으로 줄어듭니다 */}
            <div className={styles.rest}>
            <div className={styles.restIn} aria-hidden={collapsed ? 'true' : undefined}>
            <div className={styles.body} key={node.id} ref={bodyRef}>
                <div className={styles.bodyIn} ref={innerRef}>
                    {detailTop && <p className={styles.detail}>{model.detail}</p>}
                    {!hasGroups && facts}
                    {linked}
                    {/* 자리가 낮은 시트에서 머리에서 뺀 묶음 · 종류는 여기에 적습니다. */}
                    {hasGroups && tight && eyebrow.length > 0 && (
                        <p className={styles.kindLine}>
                            <i aria-hidden="true" />
                            {eyebrow.join(' · ')}
                        </p>
                    )}
                    {hasGroups && facts}
                    {model.detail && !detailTop && <p className={`${styles.detail} ${styles.detailAfter}`}>{model.detail}</p>}
                </div>
                <div ref={fixRef} aria-hidden="true" />
            </div>

            {/* 이유 칸: 스크롤 밖에 고정되어 있어 어느 조각을 가리켜도 문장 전체가 제목과 함께 보입니다. */}
            {showStrip && (
                <div ref={stripRef} className={styles.strip}>
                    <div className={styles.stripIn} aria-hidden="true">
                        <div className={styles.stack}>
                            {viaNote && <div className={styles.note} data-on={active ? 'false' : 'true'}>{viaNote}</div>}
                            {notes.map(({ item, group }) => (
                                <div key={item.key} className={styles.note} data-on={activeKey === item.key ? 'true' : 'false'}>
                                    {/* 가리킨 조각의 이름과 그 묶음 제목. 세 마디 줄(주어 › 술어 › 목적어)은 '방금 건너온 연결'에서만 씁니다. */}
                                    <p className={styles.noteName}>
                                        <strong>{item.name}</strong>
                                        <span>{group.title}</span>
                                    </p>
                                    {(item.why || item.about) && <p className={styles.noteText}>{item.why || item.about}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {model.go && (
                <footer className={styles.foot}>
                    {/* 본문으로 가는 버튼(문구는 node.go 그대로). 언제나 카드 아래에 고정됩니다. */}
                    <button type="button" className={styles.go} onClick={() => onGo(node)}>
                        <span key={node.id}>{model.go}</span>
                        <ArrowUpRight size={15} aria-hidden="true" />
                    </button>
                </footer>
            )}
            </div>
            </div>

            {/* 화면 낭독기에는 가리킨 조각의 이유를 따로 읽어 줍니다(이유 칸이 없을 때부터 있어야 바뀐 것을 읽습니다). */}
            <p className={styles.srOnly} aria-live="polite">
                {active ? [active.item.name, active.group.title, active.item.why || active.item.about].filter(Boolean).join('. ') : ''}
            </p>
        </aside>
    );
}
