import { withAuth } from "next-auth/middleware"

// 공지사항·고객센터(FAQ)는 비로그인 사용자도 열람할 수 있도록 인증 예외 경로로 둡니다.
// 고객센터의 1:1 문의 작성/내역은 페이지·API 단에서 로그인으로 가드됩니다.
const PUBLIC_DASHBOARD_PATHS = ["/dashboard/notice", "/dashboard/support"]

export default withAuth({
    pages: {
        signIn: "/login",
    },
    callbacks: {
        authorized: ({ req, token }) => {
            if (PUBLIC_DASHBOARD_PATHS.some((path) => req.nextUrl.pathname.startsWith(path))) {
                return true
            }
            return !!token
        },
    },
})

export const config = {
    matcher: ["/dashboard/:path*", "/admin/:path*"]
}
