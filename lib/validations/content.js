import { z } from 'zod';

// 1:1 문의 답변 등록 스키마
export const answerInquirySchema = z.object({
    answer: z.string().min(1, '답변 내용을 입력해주세요.'),
});

// 공지사항 작성 스키마
export const noticeSchema = z.object({
    title: z.string().min(1, '제목을 입력해주세요.'),
    content: z.string().min(1, '내용을 입력해주세요.'),
    category: z.enum(['notice', 'update', 'event'], {
        errorMap: () => ({ message: '유효하지 않은 카테고리입니다.' })
    }),
    isPinned: z.boolean().optional(),
});

// 공지사항 수정 스키마
export const updateNoticeSchema = noticeSchema.partial();

// 블로그 캠페인 상태 변경/발행 링크 추가 스키마
export const updateBlogCampaignSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled'], {
        errorMap: () => ({ message: '유효하지 않은 상태입니다.' })
    }).optional(),
    addLink: z.string().url('올바른 URL을 입력해주세요.').optional(),
});

// 환급 신청 상태 변경 스키마
export const updateRefundRequestSchema = z.object({
    status: z.enum(['pending', 'reviewing', 'approved', 'rejected', 'paid'], {
        errorMap: () => ({ message: '유효하지 않은 상태입니다.' })
    }).optional(),
    adminMemo: z.string().optional(),
});
