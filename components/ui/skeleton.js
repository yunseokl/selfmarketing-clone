import { cn } from "@/lib/utils"

function Skeleton({
    className,
    ...props
}) {
    return (
        (<div
            className={cn("animate-pulse rounded-md bg-muted", className)}
            {...props}
            style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                ...props.style
            }}
        />)
    );
}

export { Skeleton }
