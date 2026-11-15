import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { kstDateKey } from '@/lib/rank-log';
import { upsertMetric } from '@/lib/place-history';
import { savePlaceSchema, MAX_SAVED_PLACES } from '@/lib/validations/place-insight';
import { getCurrentUser, readJson, savedPlaceToClient } from '@/lib/place-api';
import { getPlaceService, placeLookupConfig, placeErrorResponse, PLACE_LOOKUP_DISABLED } from '@/lib/place-service';

export const dynamic = 'force-dynamic';

// POST - 내 매장으로 저장 { placeId }. 이름·업종은 화면이 보낸 값이 아니라 서버가 조회한 값을 씁니다.
export async function POST(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }
        if (!placeLookupConfig().enabled) {
            return NextResponse.json(PLACE_LOOKUP_DISABLED.body, { status: PLACE_LOOKUP_DISABLED.status });
        }

        const validation = savePlaceSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.flatten().fieldErrors }, { status: 400 });
        }
        const { placeId } = validation.data;
        const userId = userCheck.user.id;

        const existing = await prisma.savedPlace.findUnique({ where: { userId_placeId: { userId, placeId } } });
        if (existing) {
            return NextResponse.json({ message: '이미 저장된 매장입니다.', saved: savedPlaceToClient(existing) });
        }
        const count = await prisma.savedPlace.count({ where: { userId } });
        if (count >= MAX_SAVED_PLACES) {
            return NextResponse.json({ error: `내 매장은 ${MAX_SAVED_PLACES}곳까지 저장할 수 있습니다.` }, { status: 400 });
        }

        // 방금 조회한 결과가 남아 있으면 그대로 쓰고, 없으면 다시 조회합니다.
        const { value: place, fetchedAt } = await getPlaceService().client.getPlace(placeId);
        const points = upsertMetric([], {
            date: kstDateKey(new Date(fetchedAt)),
            visitorReviews: place.visitorReviews,
            blogReviews: place.blogReviews,
            score: place.visitorScore,
        });
        const created = await prisma.savedPlace.create({
            data: { userId, placeId, name: place.name, category: place.category || null, metrics: JSON.stringify(points) },
        });

        return NextResponse.json({ message: '내 매장으로 저장했습니다.', saved: savedPlaceToClient(created) });
    } catch (error) {
        const mapped = placeErrorResponse(error);
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
        console.error('Error saving place:', error);
        return NextResponse.json({ error: '매장 저장 중 오류가 발생했습니다.' }, { status: 500 });
    }
}

// DELETE - 저장한 내 매장 삭제 ?placeId=
export async function DELETE(request) {
    try {
        const userCheck = await getCurrentUser();
        if (userCheck.error) {
            return NextResponse.json({ error: userCheck.error }, { status: userCheck.status });
        }

        const { searchParams } = new URL(request.url);
        const validation = savePlaceSchema.safeParse({ placeId: searchParams.get('placeId') || '' });
        if (!validation.success) {
            return NextResponse.json({ error: '플레이스 ID가 올바르지 않습니다.' }, { status: 400 });
        }

        const deleted = await prisma.savedPlace.deleteMany({
            where: { userId: userCheck.user.id, placeId: validation.data.placeId },
        });
        if (deleted.count !== 1) {
            return NextResponse.json({ error: '저장된 매장을 찾을 수 없습니다.' }, { status: 404 });
        }
        return NextResponse.json({ message: '저장한 매장을 삭제했습니다.' });
    } catch (error) {
        console.error('Error deleting saved place:', error);
        return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
