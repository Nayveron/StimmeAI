import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { transcription } = await req.json()

    // GPT-4o via OpenRouter — same endpoint, just different base URL
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL!,
        'X-Title': 'Micro MVP Voice SaaS',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant in a Voice-to-Text SaaS. The user has transcribed their voice. Respond helpfully and concisely.',
          },
          {
            role: 'user',
            content: transcription,
          },
        ],
        stream: false,
      }),
    })

    const data = await response.json()
    // Key line: extract the AI response from OpenRouter's response
    const aiResponse = data.choices[0].message.content

    return NextResponse.json({ response: aiResponse })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}
