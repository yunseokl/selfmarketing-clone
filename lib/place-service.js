// 플레이스 실제 조회 — 서버 전체가 함께 쓰는 조회 창구 하나.
// 요청 간격·저장 결과·조회 중단 상태를 한 곳에서 관리해야 하므로 서버에 하나만 만듭니다.

import { createGate } from './place-gate.js';
import { createPlaceClient } from './naver-place.js';
import { createRateLimiter } from './rate-limit.js';

const TEN_MINUTES = 10 * 60 * 1000;

function intInRange(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

// PLACE_LOOKUP=off 로 기능을 끌 수 있습니다(네이버가 문제 삼거나 막았을 때 바로 끄기 위한 스위치).
export function placeLookupConfig(env = process.env) {
    const flag = String(env.PLACE_LOOKUP || '').trim().toLowerCase();
    return {
        enabled: !['off', 'false', '0', 'no'].includes(flag),
        dailyMax: intInRange(env.PLACE_LOOKUP_DAILY_MAX, 100, 50000, 3000),
    };
}

function createState() {
    const config = placeLookupConfig();
    return {
        gate: createGate({ dailyMax: config.dailyMax }),
        limits: {
            // 회원 1명이 10분 동안 쓸 수 있는 횟수
            place: createRateLimiter({ windowMs: TEN_MINUTES, max: 20 }),
            rank: createRateLimiter({ windowMs: TEN_MINUTES, max: 40 }),
            deepRank: createRateLimiter({ windowMs: TEN_MINUTES, max: 10 }),
            keywords: createRateLimiter({ windowMs: TEN_MINUTES, max: 10 }),
        },
    };
}

// 개발 서버가 코드를 다시 읽어도 조회 상태(간격·저장 결과·중단·회원별 횟수)가 초기화되지 않게 전역에 보관합니다.
// 조회 클라이언트는 상태가 거의 없어 이 모듈을 읽을 때마다 새로 만듭니다(고친 조회 코드가 재시작 없이 반영되게).
let service = null;

export function getPlaceService() {
    if (!globalThis.__honjalmaPlaceState) {
        globalThis.__honjalmaPlaceState = createState();
    }
    const state = globalThis.__honjalmaPlaceState;
    if (!service || service.gate !== state.gate) {
        service = { ...state, client: createPlaceClient({ gate: state.gate }) };
    }
    return service;
}

export function placeLookupStatus() {
    const config = placeLookupConfig();
    const status = getPlaceService().gate.status();
    return { enabled: config.enabled, ...status };
}

function timeText(ms) {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

// 조회 오류 → 회원에게 보여 줄 응답
export function placeErrorResponse(error) {
    switch (error?.code) {
        case 'BAD_INPUT':
            return { status: 400, body: { error: error.message } };
        case 'NOT_FOUND':
            return { status: 404, body: { error: '플레이스를 찾지 못했습니다. 주소나 ID를 다시 확인해주세요.' } };
        case 'BLOCKED':
        case 'PAUSED':
            return {
                status: 503,
                body: {
                    error: `네이버가 조회를 잠시 제한해 쉬는 중입니다. ${error.retryAt ? `${timeText(error.retryAt)} 이후에 ` : '잠시 후 '}다시 시도해주세요.`,
                    retryAt: error.retryAt || null,
                },
            };
        case 'DAILY_LIMIT':
            return { status: 429, body: { error: '오늘 조회 가능 횟수를 모두 사용했습니다. 내일 다시 시도해주세요.' } };
        case 'TIMEOUT':
            return { status: 504, body: { error: '네이버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해주세요.' } };
        case 'CHANGED':
            return { status: 502, body: { error: '네이버 화면 구성이 바뀌어 지금은 조회할 수 없습니다. 고객센터로 알려주시면 확인하겠습니다.' } };
        case 'UPSTREAM':
            return { status: 502, body: { error: '네이버에서 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' } };
        default:
            return null;
    }
}

export const PLACE_LOOKUP_DISABLED = { status: 503, body: { error: '플레이스 조회 기능이 현재 꺼져 있습니다.', disabled: true } };
export const PLACE_RATE_LIMITED = { status: 429, body: { error: '조회가 너무 잦습니다. 몇 분 뒤에 다시 시도해주세요.' } };
