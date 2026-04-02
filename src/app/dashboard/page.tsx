'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface RecordItem {
  id: string
  transcription: string
  aiResponse: string | null
  createdAt: string
}

export default function DashboardPage() {
  const { user } = useUser()
  const [records, setRecords] = useState<RecordItem[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(32).fill(0))
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const recordingStartRef = useRef<number>(0)

  useEffect(() => {
    fetchRecords()
  }, [])

  // Auto-redirect to Stripe checkout if user just signed up and has no subscription
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success')) return // already paid
    const needsCheckout = localStorage.getItem('freeRecordUsed')
    if (needsCheckout && records.length === 0) {
      // New user from the payment gate — send them to checkout
      localStorage.removeItem('freeRecordUsed')
      handleSubscribe()
    }
  }, [records])

  const fetchRecords = async () => {
    const res = await fetch('/api/records')
    const data = await res.json()
    setRecords(data.records || [])
  }

  const handleSubscribe = async () => {
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.location.href = url
  }

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
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

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
          setError('No voice detected. Please speak clearly.')
          return
        }

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (audioBlob.size < 1000) {
          setError('No voice detected. Please speak clearly.')
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
    setError(null)

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const whisperRes = await fetch('/api/whisper', { method: 'POST', body: formData })
      const whisperData = await whisperRes.json()

      if (!whisperRes.ok || !whisperData.text) {
        setError('No voice detected. Please speak clearly.')
        return
      }

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: whisperData.text }),
      })
      const { response } = await chatRes.json()

      await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription: whisperData.text, aiResponse: response }),
      })

      await fetchRecords()
    } catch (err) {
      console.error('Processing error:', err)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a0f]">
      {/* Background gradient */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] right-[10%] h-[500px] w-[500px] rounded-full bg-purple-600/8 blur-[128px]" />
        <div className="absolute bottom-[-10%] left-[20%] h-[400px] w-[400px] rounded-full bg-blue-600/8 blur-[128px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 backdrop-blur-md bg-black/20">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <MicIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white tracking-tight">StimmeAI</span>
              <p className="text-xs text-white/40">Welcome, {user?.firstName || 'User'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 hover:opacity-90"
              onClick={handleSubscribe}
            >
              Upgrade Plan
            </Button>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-8">
        {/* New Recording Card */}
        <Card className="mb-8 bg-white/[0.03] border-white/10 shadow-xl shadow-black/20">
          <CardContent className="p-8 flex flex-col items-center">
            <h2 className="text-lg font-semibold text-white mb-6">New Recording</h2>

            {/* Waveform */}
            {isRecording && (
              <div className="flex items-center justify-center gap-[2px] mb-4" style={{ height: 40, width: 180 }}>
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

            {/* Record button */}
            <div className="relative mb-3">
              {isRecording && (
                <>
                  <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
                  <span className="absolute -inset-2 rounded-full bg-red-500/10 animate-pulse" />
                </>
              )}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`
                  relative h-16 w-16 rounded-full flex items-center justify-center
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
                  <StopIcon className="w-6 h-6 text-white" />
                ) : (
                  <MicIcon className="w-6 h-6 text-white" />
                )}
              </button>
            </div>

            {isRecording && (
              <p className="text-sm text-red-400 animate-pulse">Listening... tap to stop</p>
            )}
            {isProcessing && (
              <p className="text-sm text-white/40">Transcribing your voice...</p>
            )}
            {error && (
              <p className="text-sm text-red-400 mt-2">{error}</p>
            )}
          </CardContent>
        </Card>

        {/* Records */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Your Records</h2>
          <Badge className="bg-white/5 text-white/40 border-white/10">
            {records.length} total
          </Badge>
        </div>

        <ScrollArea className="h-[500px]">
          {records.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-12 w-12 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-3">
                <MicIcon className="w-6 h-6 text-white/20" />
              </div>
              <p className="text-white/30 text-sm">
                No records yet. Start recording to see your transcriptions here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <Card key={record.id} className="bg-white/[0.03] border-white/10 shadow-lg shadow-black/10">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                        You
                      </Badge>
                      <span className="text-xs text-white/30">
                        {new Date(record.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-white/80 mb-4 leading-relaxed">{record.transcription}</p>
                    {record.aiResponse && (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                            AI
                          </Badge>
                        </div>
                        <p className="text-sm text-white/50 leading-relaxed">{record.aiResponse}</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </main>
    </div>
  )
}

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
