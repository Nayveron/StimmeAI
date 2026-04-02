import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File

    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Key line: model: 'whisper-1' is the transcription model
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'whisper-1',
      language: 'uk', // Ukrainian — change as needed
    })

    return NextResponse.json({ text: transcription.text })
  } catch (error) {
    console.error('Whisper error:', error)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
