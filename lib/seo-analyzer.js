// 네이버 쇼핑 SEO 가이드 기반 상품명 분석기 (순수 클라이언트 로직, 서버 호출 없음)

const SPECIAL_CHAR_REGEX = /[[\]{}()~!@#$%^&*+=|\\<>?★☆♥♡◆◇■□▶▷●]/g;
const PARTICLE_REGEX = /은|는|이|가|을|를|의|에서|으로|와|과|도|만|입니다|해요/g;
const SPEC_UNIT_REGEX = /\d+\s?(ml|l|kg|g|mg|cm|mm|inch|인치|gb|tb|mb|개입|개|매|포|box|박스|리터|팩)/i;
const ABUSE_WORDS = ['최저가', '무료배송', '정품', '이벤트', '할인', '세일', '파격', '역대급', '초특가', '한정수량', '핫딜', '1위'];

function getWords(text) {
    return text.split(/\s+/).filter(Boolean);
}

function buildChecks(name, keyword) {
    const length = [...name].length;
    const nameLower = name.toLowerCase();
    const keywordLower = keyword.toLowerCase();
    const words = getWords(name);

    const lengthPassed = length >= 25 && length <= 50;

    const keywordIncluded = keyword.length > 0 && nameLower.includes(keywordLower);
    const keywordIndex = keywordIncluded ? nameLower.indexOf(keywordLower) : -1;
    const keywordPositionPassed = keywordIncluded && keywordIndex <= 15;

    const specialMatches = name.match(SPECIAL_CHAR_REGEX) || [];
    const noSpecialChars = specialMatches.length === 0;

    const wordCounts = words.reduce((acc, w) => {
        acc[w] = (acc[w] || 0) + 1;
        return acc;
    }, {});
    const repeatedWord = Object.entries(wordCounts).find(([, count]) => count >= 3);
    const noWordRepetition = !repeatedWord;

    const foundAbuseWords = ABUSE_WORDS.filter(w => name.includes(w));
    const noAbuseWords = foundAbuseWords.length === 0;

    const firstWord = words[0] || '';
    const brandStart = /[A-Za-z0-9]/.test(firstWord);

    const hasSpec = SPEC_UNIT_REGEX.test(name);

    const particleMatches = name.match(PARTICLE_REGEX) || [];
    const noExcessiveParticles = particleMatches.length <= 3;

    return [
        {
            id: 'length_range',
            label: '상품명 글자수 (공백 포함 25~50자)',
            passed: lengthPassed,
            points: 15,
            advice: lengthPassed
                ? '적정 글자수를 잘 지켰습니다.'
                : length < 25
                    ? `현재 ${length}자로 너무 짧습니다. 특징이나 스펙을 추가해 25자 이상으로 늘려보세요.`
                    : `현재 ${length}자로 너무 깁니다. 핵심 정보만 남기고 50자 이하로 줄여보세요.`,
        },
        {
            id: 'keyword_included',
            label: '핵심 키워드 포함',
            passed: keywordIncluded,
            points: 20,
            advice: keywordIncluded
                ? '핵심 키워드가 상품명에 포함되어 있습니다.'
                : `상품명에 "${keyword || '타겟 키워드'}"를 자연스럽게 포함시켜주세요.`,
        },
        {
            id: 'keyword_position',
            label: '키워드 앞쪽 배치 (15자 이내)',
            passed: keywordPositionPassed,
            points: 10,
            advice: keywordPositionPassed
                ? '키워드가 앞쪽에 배치되어 검색 노출에 유리합니다.'
                : keywordIncluded
                    ? '키워드를 상품명 앞쪽으로 옮기면 검색 노출에 더 유리합니다.'
                    : '키워드를 포함한 뒤 앞쪽에 배치해주세요.',
        },
        {
            id: 'no_special_chars',
            label: '특수문자 미사용',
            passed: noSpecialChars,
            points: 10,
            advice: noSpecialChars
                ? '특수문자 없이 깔끔하게 작성되었습니다.'
                : `"${[...new Set(specialMatches)].join(' ')}" 같은 특수문자는 검색 누락 위험이 있어 제거를 권장합니다.`,
        },
        {
            id: 'no_word_repetition',
            label: '동일 단어 반복 사용 안 함',
            passed: noWordRepetition,
            points: 10,
            advice: noWordRepetition
                ? '단어 반복 없이 자연스럽습니다.'
                : `"${repeatedWord?.[0]}" 단어가 ${repeatedWord?.[1]}회 반복됩니다. 유사어로 바꿔주세요.`,
        },
        {
            id: 'no_abusing_words',
            label: '어뷰징성 단어 미사용',
            passed: noAbuseWords,
            points: 15,
            advice: noAbuseWords
                ? '어뷰징성 단어 없이 신뢰도 높게 작성되었습니다.'
                : `"${foundAbuseWords.join(', ')}" 같은 표현은 검색 제재 위험이 있어 제거를 권장합니다.`,
        },
        {
            id: 'brand_or_model_start',
            label: '브랜드/모델명으로 시작',
            passed: brandStart,
            points: 10,
            advice: brandStart
                ? '브랜드 또는 모델명이 앞쪽에 있어 신뢰도를 높입니다.'
                : '상품명 맨 앞에 브랜드명이나 모델명을 넣으면 신뢰도와 검색 노출에 도움이 됩니다.',
        },
        {
            id: 'numeric_spec_included',
            label: '숫자 스펙(용량/수량 등) 포함',
            passed: hasSpec,
            points: 5,
            advice: hasSpec
                ? '용량, 수량 등 구체적인 스펙 정보가 포함되어 있습니다.'
                : '용량, 수량, 사이즈 같은 구체적인 숫자 스펙을 추가하면 좋습니다.',
        },
        {
            id: 'no_excessive_particles',
            label: '조사·수식어 과다 사용 안 함',
            passed: noExcessiveParticles,
            points: 5,
            advice: noExcessiveParticles
                ? '조사와 수식어 사용이 적절합니다.'
                : '조사(은,는,이,가 등)나 수식어 사용을 줄이고 핵심 단어 위주로 정리해보세요.',
        },
    ];
}

function getGrade(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 50) return 'C';
    return 'D';
}

function buildCleanedWords(name) {
    const withoutSpecial = name.replace(SPECIAL_CHAR_REGEX, ' ');
    let words = withoutSpecial.split(/\s+/).filter(Boolean);
    words = words.filter(w => !ABUSE_WORDS.includes(w));

    const counts = {};
    words = words.filter(w => {
        counts[w] = (counts[w] || 0) + 1;
        return counts[w] <= 2;
    });

    return words;
}

function buildSuggestions(name, keyword) {
    const words = buildCleanedWords(name);
    const keywordWords = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
    const restWords = words.filter(w => !keywordWords.includes(w));

    const suggestions = new Set();

    if (keywordWords.length > 0) {
        // 키워드를 맨 앞에 배치
        suggestions.add([...keywordWords, ...restWords].join(' '));

        // 브랜드(첫 단어) 유지 + 키워드를 바로 뒤에 배치
        const firstWord = words[0];
        if (firstWord && !keywordWords.includes(firstWord)) {
            const rest2 = restWords.filter(w => w !== firstWord);
            suggestions.add([firstWord, ...keywordWords, ...rest2].join(' '));
        }

        // 핵심 단어 위주로 간결하게
        suggestions.add([...keywordWords, ...restWords.slice(0, 4)].join(' '));
    } else {
        suggestions.add(words.join(' '));
    }

    return Array.from(suggestions)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 3);
}

// 상품명/키워드를 분석해 SEO 점수, 등급, 체크리스트, 개선 상품명을 반환합니다.
export function analyzeSeo(input = {}) {
    const productName = (input.productName || '').trim();
    const keyword = (input.keyword || '').trim();

    const checks = buildChecks(productName, keyword);
    const score = checks.reduce((total, check) => total + (check.passed ? check.points : 0), 0);
    const grade = getGrade(score);
    const suggestions = buildSuggestions(productName, keyword);

    return { score, grade, checks, suggestions };
}
