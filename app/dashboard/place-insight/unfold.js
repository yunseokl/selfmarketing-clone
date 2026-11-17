'use client';

// 그래프 점 → 본문 이동을 위한 '접힌 목록 펼치기' 통로.
// 본문의 접히는 목록(더 보기·탭)은 useUnfold 로 { has(id), open(id) } 를 등록합니다.
// 페이지는 그래프에서 고른 점이 접힌 줄에 있으면 open 을 불러 펼친 뒤(flushSync 로 그려진 다음) 그 줄로 이동합니다.

import { createContext, useContext, useEffect, useRef } from 'react';

export const Unfold = createContext(null);

// has(id): 이 목록이 그 점의 줄을 접어 두고 있는지 / open(id): 그 줄이 보이게 펼칩니다.
export function useUnfold(has, open) {
    const registry = useContext(Unfold);
    const self = useRef(null);
    self.current = { has, open };
    useEffect(() => {
        if (!registry) return undefined;
        registry.add(self);
        return () => {
            registry.delete(self);
        };
    }, [registry]);
}

// 등록된 목록 가운데 그 점의 줄을 접어 둔 것을 모두 펼칩니다(펼친 것이 있으면 true).
// flushSync 안에서 부르면 펼친 줄이 곧바로 그려집니다.
export function unfoldIn(registry, id) {
    let opened = false;
    for (const entry of registry || []) {
        if (entry.current?.has(id)) {
            entry.current.open(id);
            opened = true;
        }
    }
    return opened;
}
