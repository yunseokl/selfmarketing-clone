import { z } from 'zod';

// 관리자 주문 CSV 내보내기(플레이스/쇼핑 공용) 요청 검증
export const exportOrdersSchema = z.object({
    orderIds: z.array(z.string().min(1, '주문 ID가 올바르지 않습니다.'))
        .min(1, '다운로드할 주문을 선택해주세요.')
        .max(1000, '한 번에 최대 1000건까지 다운로드할 수 있습니다.'),
});
