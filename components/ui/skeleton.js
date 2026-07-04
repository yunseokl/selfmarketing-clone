import { cn } from "@/lib/utils"
import styles from "./skeleton.module.css"

// 이 프로젝트는 Tailwind가 설치되어 있지 않아 className으로 전달되는
// h-N / w-N 유틸리티 토큰(Tailwind 4px 스페이싱 스케일)을 직접 해석해
// 실제 크기로 적용합니다. 사용처의 className 계약(h-6 w-48 등)은 그대로 유지됩니다.
function extractSizeStyle(className = "") {
    const style = {};
    for (const token of className.split(/\s+/)) {
        const heightMatch = token.match(/^h-(\d+)$/);
        const widthMatch = token.match(/^w-(\d+)$/);
        if (heightMatch) style.height = `${Number(heightMatch[1]) * 0.25}rem`;
        if (widthMatch) style.width = `${Number(widthMatch[1]) * 0.25}rem`;
    }
    return style;
}

function Skeleton({
    className,
    style,
    ...props
}) {
    return (
        (<div
            className={cn(styles.skeleton, className)}
            {...props}
            style={{
                ...extractSizeStyle(className),
                ...style
            }}
        />)
    );
}

export { Skeleton }
