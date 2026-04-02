import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: { records: { orderBy: { createdAt: 'desc' } } },
  })

  if (!user) return NextResponse.json({ records: [] })

  return NextResponse.json({ records: user.records })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { transcription, aiResponse } = await req.json()

  // Ensure user exists in DB (sync from Clerk on first record save)
  const user = await prisma.user.upsert({
    where: { clerkId: userId },
    create: { clerkId: userId, email: `${userId}@clerk.user` },
    update: {},
  })

  const record = await prisma.record.create({
    data: {
      userId: user.id,
      transcription,
      aiResponse,
    },
  })

  return NextResponse.json({ record })
}
