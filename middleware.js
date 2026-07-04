import { withAuth } from "next-auth/middleware"

// 공지사항은 비로그인 사용자도 열람할 수 있도록 인증 예외 경로로 둡니다.
const PUBLIC_DASHBOARD_PATHS = ["/dashboard/notice"]

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
