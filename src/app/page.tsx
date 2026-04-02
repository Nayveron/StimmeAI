'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Message {
  id: string
  type: 'transcription' | 'ai' | 'error'
  content: string
}

export default function HomePage() {
  const router = useRouter()
  const { isSignedIn } = useAuth()
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(32).fill(0))
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const recordingStartRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    const step = Math.floor(data.length / 32)
    const levels = Array.from({ length: 32 }, (_, i) => data[i * step] / 255)
    setAudioLevels(levels)
    animFrameRef.current = requestAnimationFrame(updateWaveform)
  }, [])

  const startRecording = async () => {
    if (!isSignedIn) {
      const freeRecordUsed = localStorage.getItem('freeRecordUsed')
      if (freeRecordUsed) {
        setShowAuthModal(true)
        return
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Set up audio analyser for waveform visualization
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      recordingStartRef.current = Date.now()

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current)
        setAudioLevels(new Array(32).fill(0))
        stream.getTracks().forEach((track) => track.stop())
        audioCtx.close()
        analyserRef.current = null

        const duration = Date.now() - recordingStartRef.current

        // Silence detection: reject recordings shorter than 1 second
        if (duration < 1000) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              type: 'error',
              content: 'No voice detected. Please speak clearly.',
            },
          ])
          return
        }

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })

        // Check if audio blob is too small (silence produces tiny blobs)
        if (audioBlob.size < 1000) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              type: 'error',
              content: 'No voice detected. Please speak clearly.',
            },
          ])
          return
        }

        await processAudio(audioBlob)
      }

      mediaRecorder.start()
      setIsRecording(true)
      updateWaveform()
    } catch {
      console.error('Microphone access denied')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true)

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const whisperRes = await fetch('/api/whisper', {
        method: 'POST',
        body: formData,
      })
      const whisperData = await whisperRes.json()

      if (!whisperRes.ok || !whisperData.text) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: 'error',
            content: 'No voice detected. Please speak clearly.',
          },
        ])
        return
      }

      const transcriptionMsg: Message = {
        id: Date.now().toString(),
        type: 'transcription',
        content: whisperData.text,
      }
      setMessages((prev) => [...prev, transcriptionMsg])

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: whisperData.text }),
      })
      const { response } = await chatRes.json()

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: response,
      }
      setMessages((prev) => [...prev, aiMsg])

      if (isSignedIn) {
        await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcription: whisperData.text, aiResponse: response }),
        })
      }

      if (!isSignedIn) {
        localStorage.setItem('freeRecordUsed', 'true')
      }
    } catch (error) {
      console.error('Processing error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#0a0a0f]">
      {/* Background gradient */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[30%] h-[600px] w-[600px] rounded-full bg-purple-600/10 blur-[128px]" />
        <div className="absolute bottom-[-10%] right-[20%] h-[400px] w-[400px] rounded-full bg-blue-600/10 blur-[128px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 backdrop-blur-md bg-black/20">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <MicIcon className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">StimmeAI</span>
          </div>
          <div className="flex gap-2">
            {isSignedIn ? (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={() => router.push('/dashboard')}
              >
                Dashboard
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/5"
                  onClick={() => router.push('/sign-in')}
                >
                  Sign In
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 hover:opacity-90"
                  onClick={() => router.push('/sign-up')}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 mx-auto w-full max-w-2xl px-6 flex flex-col">
        {messages.length === 0 ? (
          /* Hero — empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <div className="mb-6">
              <Badge className="bg-purple-500/10 text-purple-300 border-purple-500/20 mb-6 px-3 py-1">
                Powered by Whisper & GPT-4o
              </Badge>
            </div>
            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-4 leading-[1.1]">
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Voice to Text
              </span>
              <br />
              <span className="text-white">Intelligence</span>
            </h1>
            <p className="text-white/50 text-lg max-w-md mb-10 leading-relaxed">
              Record your voice and get instant AI-powered transcription
              and intelligent responses. First recording is free.
            </p>

            {/* Record button — hero position */}
            <RecordButton
              isRecording={isRecording}
              isProcessing={isProcessing}
              audioLevels={audioLevels}
              onStart={startRecording}
              onStop={stopRecording}
            />
            {isRecording && (
              <p className="mt-4 text-sm text-red-400 animate-pulse tracking-wide">
                Listening... tap to stop
              </p>
            )}
            {isProcessing && (
              <p className="mt-4 text-sm text-white/40">Transcribing your voice...</p>
            )}
          </div>
        ) : (
          /* Chat — messages state */
          <>
            <ScrollArea className="flex-1 py-6">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      msg.type === 'transcription'
                        ? 'flex justify-end'
                        : 'flex justify-start'
                    }
                  >
                    {msg.type === 'error' ? (
                      <Card className="max-w-[85%] bg-red-500/10 border-red-500/20 shadow-lg shadow-red-500/5">
                        <CardContent className="p-4">
                          <p className="text-sm text-red-300">{msg.content}</p>
                        </CardContent>
                      </Card>
                    ) : msg.type === 'transcription' ? (
                      <Card className="max-w-[85%] bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-purple-500/10 shadow-lg shadow-purple-500/5">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                              You
                            </Badge>
                          </div>
                          <p className="text-sm text-white/90 leading-relaxed">{msg.content}</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="max-w-[85%] bg-white/5 border-white/10 shadow-lg shadow-black/20">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                              AI
                            </Badge>
                          </div>
                          <p className="text-sm text-white/80 leading-relaxed">{msg.content}</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex justify-start">
                    <Card className="max-w-[85%] bg-white/5 border-white/10">
                      <CardContent className="p-4">
                        <div className="flex gap-1.5">
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                          <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Bottom record bar */}
            <div className="py-6 flex flex-col items-center gap-3 border-t border-white/5">
              <RecordButton
                isRecording={isRecording}
                isProcessing={isProcessing}
                audioLevels={audioLevels}
                onStart={startRecording}
                onStop={stopRecording}
                size="sm"
              />
              {isRecording && (
                <p className="text-xs text-red-400 animate-pulse">Listening...</p>
              )}
            </div>
          </>
        )}
      </main>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <Card className="w-full max-w-sm mx-4 bg-[#12121a] border-white/10 shadow-2xl">
            <CardContent className="p-8 text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4">
                <MicIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Sign up to continue</h3>
              <p className="text-white/50 text-sm mb-6">
                Your free recording has been used. Create an account for unlimited access.
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => setShowAuthModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0"
                  onClick={() => router.push('/sign-up')}
                >
                  Get Started
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── Record Button with waveform ─────────────────────────────── */
function RecordButton({
  isRecording,
  isProcessing,
  audioLevels,
  onStart,
  onStop,
  size = 'lg',
}: {
  isRecording: boolean
  isProcessing: boolean
  audioLevels: number[]
  onStart: () => void
  onStop: () => void
  size?: 'lg' | 'sm'
}) {
  const btnSize = size === 'lg' ? 'h-20 w-20' : 'h-14 w-14'
  const iconSize = size === 'lg' ? 'w-8 h-8' : 'w-5 h-5'
  const waveH = size === 'lg' ? 48 : 32
  const waveW = size === 'lg' ? 200 : 140

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Waveform visualizer — visible only while recording */}
      {isRecording && (
        <div className="flex items-center justify-center gap-[2px]" style={{ height: waveH, width: waveW }}>
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-purple-500 to-blue-400 transition-all duration-75"
              style={{
                height: `${Math.max(8, level * 100)}%`,
                opacity: 0.4 + level * 0.6,
              }}
            />
          ))}
        </div>
      )}

      {/* Button */}
      <div className="relative">
        {/* Pulse rings when recording */}
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
            <span className="absolute -inset-2 rounded-full bg-red-500/10 animate-pulse" />
          </>
        )}
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={isProcessing}
          className={`
            relative ${btnSize} rounded-full flex items-center justify-center
            transition-all duration-200 cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed
            ${
              isRecording
                ? 'bg-red-500 shadow-lg shadow-red-500/30 hover:bg-red-600'
                : 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-105'
            }
          `}
        >
          {isRecording ? (
            <StopIcon className={`${iconSize} text-white`} />
          ) : (
            <MicIcon className={`${iconSize} text-white`} />
          )}
        </button>
      </div>
    </div>
  )
}

/* ── Icons ────────────────────────────────────────────────────── */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
