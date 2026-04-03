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
  const { isSignedIn, isLoaded } = useAuth()
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(32).fill(0))
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const recordingStartRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Check subscription status for signed-in users
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    fetch('/api/subscription/status')
      .then((res) => res.json())
      .then(({ active }) => setHasSubscription(active))
      .catch(() => setHasSubscription(false))
  }, [isLoaded, isSignedIn])

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
    if (!isLoaded) return

    // Gate logic for recording attempts:
    // 1. Not signed in + already used free record → show auth modal
    // 2. Signed in but no subscription → redirect to /checkout (Stripe)
    // 3. Not signed in + first time → allow free recording
    // 4. Signed in + has subscription → allow recording
    if (!isSignedIn) {
      const freeRecordUsed = localStorage.getItem('freeRecordUsed')
      if (freeRecordUsed) {
        setShowAuthModal(true)
        return
      }
    } else if (hasSubscription === false) {
      // Signed in but no active subscription → send to Stripe
      router.push('/checkout')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

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

        if (duration < 1000) {
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), type: 'error', content: 'No voice detected. Please speak clearly.' },
          ])
          return
        }

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (audioBlob.size < 1000) {
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), type: 'error', content: 'No voice detected. Please speak clearly.' },
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

    // Mark free record as used immediately for anonymous users
    if (!isSignedIn) {
      localStorage.setItem('freeRecordUsed', 'true')
    }

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const whisperRes = await fetch('/api/whisper', { method: 'POST', body: formData })
      const whisperData = await whisperRes.json()

      if (!whisperRes.ok || !whisperData.text) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), type: 'error', content: 'No voice detected. Please speak clearly.' },
        ])
        return
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), type: 'transcription', content: whisperData.text },
      ])

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: whisperData.text }),
      })
      const { response } = await chatRes.json()

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), type: 'ai', content: response },
      ])

      if (isSignedIn) {
        await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcription: whisperData.text, aiResponse: response }),
        })
      }
    } catch (error) {
      console.error('Processing error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  // No localStorage flags needed — Clerk redirects to /checkout after auth,
  // which checks subscription and redirects to Stripe if needed
  const handleGateSignUp = () => router.push('/sign-up')
  const handleGateSignIn = () => router.push('/sign-in')

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#07070d]">
      {/* Animated background gradients */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-30%] left-[20%] h-[700px] w-[700px] rounded-full bg-purple-600/8 blur-[160px] animate-pulse [animation-duration:8s]" />
        <div className="absolute bottom-[-20%] right-[10%] h-[500px] w-[500px] rounded-full bg-blue-600/8 blur-[140px] animate-pulse [animation-duration:12s]" />
        <div className="absolute top-[40%] right-[40%] h-[300px] w-[300px] rounded-full bg-cyan-500/5 blur-[120px] animate-pulse [animation-duration:10s]" />
      </div>

      {/* Header — taller with more padding */}
      <header className="relative z-10 border-b border-white/5 backdrop-blur-xl bg-black/30">
        <div className="mx-auto max-w-5xl px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <MicIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">StimmeAI</span>
          </div>
          <div className="flex gap-3">
            {/* Dashboard button ONLY shows when signed in */}
            {isSignedIn && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={() => router.push('/dashboard')}
              >
                Dashboard
              </Button>
            )}
            {!isSignedIn && isLoaded && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/60 hover:text-white hover:bg-white/5"
                  onClick={() => router.push('/sign-in')}
                >
                  Sign In
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 hover:opacity-90 shadow-md shadow-purple-500/20"
                  onClick={() => router.push('/sign-up')}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 mx-auto w-full max-w-2xl px-6 flex flex-col">
        {messages.length === 0 ? (
          /* ── Landing page ── */
          <div className="flex-1 flex flex-col">
            {/* Hero — taller with more breathing room */}
            <section className="flex flex-col items-center justify-center text-center py-24 sm:py-32">
              <Badge className="bg-purple-500/10 text-purple-300 border-purple-500/20 mb-8 px-4 py-1.5 text-xs tracking-wide">
                Powered by Whisper & GPT-4o
              </Badge>
              <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-6 leading-[1.05]">
                <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  Voice to Text
                </span>
                <br />
                <span className="text-white">Intelligence</span>
              </h1>
              <p className="text-white/40 text-lg sm:text-xl max-w-lg mb-12 leading-relaxed">
                Record your voice and get instant AI-powered transcription
                and intelligent responses. First recording is free.
              </p>

              <RecordButton
                isRecording={isRecording}
                isProcessing={isProcessing}
                audioLevels={audioLevels}
                onStart={startRecording}
                onStop={stopRecording}
              />
              {isRecording && (
                <p className="mt-5 text-sm text-red-400 animate-pulse tracking-wide">
                  Listening... tap to stop
                </p>
              )}
              {isProcessing && (
                <p className="mt-5 text-sm text-white/30">Transcribing your voice...</p>
              )}
            </section>

            {/* How it works */}
            <section className="py-16 border-t border-white/5">
              <h2 className="text-center text-2xl font-bold text-white mb-2">How it works</h2>
              <p className="text-center text-white/30 text-sm mb-12">Three simple steps to get started</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  { step: '1', title: 'Record your voice', desc: 'Click the microphone and speak naturally' },
                  { step: '2', title: 'Get transcription', desc: 'Whisper AI converts your speech to text instantly' },
                  { step: '3', title: 'Receive AI response', desc: 'GPT-4o analyzes your text and responds intelligently' },
                ].map((item) => (
                  <div key={item.step} className="flex flex-col items-center text-center">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center mb-4">
                      <span className="text-lg font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">{item.step}</span>
                    </div>
                    <h3 className="text-white font-semibold text-sm mb-1">{item.title}</h3>
                    <p className="text-white/30 text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Features */}
            <section className="py-16 border-t border-white/5">
              <h2 className="text-center text-2xl font-bold text-white mb-2">Features</h2>
              <p className="text-center text-white/30 text-sm mb-12">Everything you need in a voice AI platform</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <Card className="bg-white/[0.03] border-white/8 shadow-xl shadow-black/20 hover:border-purple-500/20 transition-colors">
                  <CardContent className="p-6 text-center">
                    <div className="h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                      <ZapIcon className="w-6 h-6 text-purple-400" />
                    </div>
                    <h3 className="text-white font-semibold mb-2">Instant Transcription</h3>
                    <p className="text-white/30 text-xs leading-relaxed">
                      Whisper AI converts voice to text in seconds with industry-leading accuracy
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-white/[0.03] border-white/8 shadow-xl shadow-black/20 hover:border-blue-500/20 transition-colors">
                  <CardContent className="p-6 text-center">
                    <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                      <BrainIcon className="w-6 h-6 text-blue-400" />
                    </div>
                    <h3 className="text-white font-semibold mb-2">AI-Powered Responses</h3>
                    <p className="text-white/30 text-xs leading-relaxed">
                      GPT-4o analyzes and responds to your recording with intelligent suggestions
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-white/[0.03] border-white/8 shadow-xl shadow-black/20 hover:border-cyan-500/20 transition-colors">
                  <CardContent className="p-6 text-center">
                    <div className="h-12 w-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                      <ShieldIcon className="w-6 h-6 text-cyan-400" />
                    </div>
                    <h3 className="text-white font-semibold mb-2">Secure & Private</h3>
                    <p className="text-white/30 text-xs leading-relaxed">
                      Your data is encrypted and stored safely with enterprise-grade security
                    </p>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Footer spacer */}
            <div className="py-8" />
          </div>
        ) : (
          /* ── Chat view ── */
          <>
            <ScrollArea className="flex-1 py-6">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={msg.type === 'transcription' ? 'flex justify-end' : 'flex justify-start'}
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
                          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs mb-2">You</Badge>
                          <p className="text-sm text-white/90 leading-relaxed">{msg.content}</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="max-w-[85%] bg-white/5 border-white/10 shadow-lg shadow-black/20">
                        <CardContent className="p-4">
                          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs mb-2">AI</Badge>
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

      {/* Auth Modal — only triggered by recording gate */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <Card className="w-full max-w-sm mx-4 bg-[#12121a] border-white/10 shadow-2xl">
            <CardContent className="p-8 text-center">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4">
                <MicIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Sign up to continue</h3>
              <p className="text-white/50 text-sm mb-6">
                Your free recording has been used. Create an account and subscribe for unlimited access.
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
                  variant="outline"
                  className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={handleGateSignIn}
                >
                  Sign In
                </Button>
                <Button
                  className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0"
                  onClick={handleGateSignUp}
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
      {isRecording && (
        <div className="flex items-center justify-center gap-[2px]" style={{ height: waveH, width: waveW }}>
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-purple-500 to-blue-400 transition-all duration-75"
              style={{ height: `${Math.max(8, level * 100)}%`, opacity: 0.4 + level * 0.6 }}
            />
          ))}
        </div>
      )}
      <div className="relative">
        {isRecording && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
            <span className="absolute -inset-3 rounded-full bg-red-500/10 animate-pulse" />
          </>
        )}
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={isProcessing}
          className={`
            relative ${btnSize} rounded-full flex items-center justify-center
            transition-all duration-200 cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed
            ${isRecording
              ? 'bg-red-500 shadow-lg shadow-red-500/30 hover:bg-red-600'
              : 'bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:scale-105'
            }
          `}
        >
          {isRecording ? <StopIcon className={`${iconSize} text-white`} /> : <MicIcon className={`${iconSize} text-white`} />}
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

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <line x1="10" y1="23" x2="14" y2="23" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}
