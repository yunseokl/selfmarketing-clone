'use client';

// AI 답변 실측 기록 저장소. 요약 줄과 실측 화면이 같은 기록을 함께 보도록 한곳에서 읽고 씁니다.
// 기록은 이 브라우저(localStorage)에만 남고 외부로 보내지 않습니다. 저장이 막힌 브라우저에서는 이번 화면에서만 기억합니다.

import { useCallback, useSyncExternalStore } from 'react';
import { PLATFORMS, isSomRank } from '@/lib/place-geo';

export const SOM_STORAGE_PREFIX = 'place-geo-som:v1:';
// 하루에 기준점·다시 재기를 여러 번 남겨도 한 달 치 흐름이 지워지지 않을 만큼 둡니다.
export const SOM_KEEP = 30;

const EMPTY = [];
const listeners = new Map();
const cache = new Map();
const memory = new Map();
// 저장에 실패한 키는 그 뒤로 memory 값만 읽습니다(localStorage 의 옛 값으로 되돌아가지 않게).
const blocked = new Set();

// 저장된 값에서 모양이 맞는 기록만 꺼냅니다.
function normalize(parsed) {
    if (!Array.isArray(parsed)) return EMPTY;
    const entries = parsed
        .filter((entry) => entry && typeof entry.at === 'string' && Array.isArray(entry.results))
        .map((entry) => ({
            at: entry.at,
            results: entry.results.map((row) => ({
                prompt: String(row?.prompt || ''),
                ranks: Object.fromEntries(PLATFORMS.map((p) => [p.key, isSomRank(row?.ranks?.[p.key]) ? row.ranks[p.key] : null])),
            })),
        }))
        .slice(-SOM_KEEP);
    return entries.length ? entries : EMPTY;
}

function readRaw(key) {
    if (blocked.has(key)) return memory.get(key) ?? null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return memory.get(key) ?? null;
    }
}

function snapshot(key) {
    const raw = readRaw(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value;
    let value = EMPTY;
    try {
        value = normalize(JSON.parse(raw || 'null'));
    } catch {
        value = EMPTY;
    }
    cache.set(key, { raw, value });
    return value;
}

function notify(key) {
    for (const listener of listeners.get(key) || []) listener();
}

function subscribe(key, listener) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(listener);
    const onStorage = (event) => {
        if (event.key === key) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.get(key)?.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

function write(key, entries) {
    const raw = JSON.stringify(normalize(entries));
    memory.set(key, raw);
    try {
        window.localStorage.setItem(key, raw);
        blocked.delete(key);
    } catch {
        blocked.add(key);
    }
    notify(key);
}

// [기록 목록, 기록 목록을 바꾸는 함수]
export function useSomHistory(placeId) {
    const key = SOM_STORAGE_PREFIX + placeId;
    const history = useSyncExternalStore(
        useCallback((listener) => subscribe(key, listener), [key]),
        () => snapshot(key),
        () => EMPTY,
    );
    const save = useCallback((entries) => write(key, entries), [key]);
    return [history, save];
}
