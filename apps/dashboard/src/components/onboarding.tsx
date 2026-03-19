import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Key,
  Bot,
  ListTodo,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
  EyeOff,
  Check,
  SkipForward,
  Sparkles,
  Rocket,
  PartyPopper,
  X,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import {
  saveLlmKeys,
  createAgent,
  createTask,
  type Agent,
  type CreateAgentPayload,
  type CreateTaskPayload,
} from '@/lib/api'

const STORAGE_KEY = 'shackleai-onboarding-dismissed'

const STEPS = [
  { label: 'Welcome', icon: Sparkles },
  { label: 'API Key', icon: Key },
  { label: 'Agent', icon: Bot },
  { label: 'Task', icon: ListTodo },
] as const

const ADAPTER_TYPES = ['crewai', 'process', 'http', 'claude', 'mcp', 'openclaw'] as const

/**
 * Check whether the onboarding wizard has been dismissed via localStorage.
 */
export function isOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function dismissOnboarding(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    // localStorage may be unavailable in some environments
  }
}

function StepIndicator({
  current,
  total,
}: {
  current: number
  total: number
}) {
  return (
    <div className="flex items-center justify-center gap-2" role="group" aria-label="Onboarding progress">
      {Array.from({ length: total }).map((_, i) => {
        const step = STEPS[i]
        const isActive = i === current
        const isComplete = i < current
        const Icon = step.icon
        return (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`hidden h-px w-8 sm:block ${
                  isComplete ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isComplete
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${i + 1}: ${step.label}${isComplete ? ' (completed)' : ''}`}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
            </div>
            <span
              className={`hidden text-xs sm:inline ${
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={'h-1.5 rounded-full transition-all duration-300 ' + (
            i === current
              ? 'w-6 bg-primary'
              : i < current
                ? 'w-1.5 bg-primary/40'
                : 'w-1.5 bg-muted'
          )}
        />
      ))}
    </div>
  )
}

function StepWelcome({
  onNext,
  onDismiss,
  dontShowAgain,
  setDontShowAgain,
}: {
  onNext: () => void
  onDismiss: () => void
  dontShowAgain: boolean
  setDontShowAgain: (v: boolean) => void
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Rocket className="h-8 w-8 text-primary" />
        </div>
      </div>
      <div className="space-y-2">
        <CardTitle className="text-xl">Welcome to ShackleAI</CardTitle>
        <CardDescription className="text-balance">
          Get your orchestrator up and running. This wizard will walk you
          through setting up an API key, creating your first agent, and
          assigning it a task.
        </CardDescription>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 text-left text-sm">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Key className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Configure API key</p>
              <p className="text-muted-foreground">Connect your LLM provider</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Hire an agent</p>
              <p className="text-muted-foreground">Create your first AI worker</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Assign a task</p>
              <p className="text-muted-foreground">Give your agent its first job</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            Don&apos;t show again
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>
            <Button onClick={onNext}>
              Get Started
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepApiKey({
  companyId,
  onNext,
  onBack,
}: {
  companyId: string
  onNext: () => void
  onBack: () => void
}) {
  const { toast } = useToast()
  const [openaiKey, setOpenaiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  const mutation = useMutation({
    mutationFn: () => saveLlmKeys(companyId, { openai: openaiKey }),
    onSuccess: () => {
      toast('API key saved', 'success')
      onNext()
    },
    onError: (err: Error) => {
      toast(`Failed to save key: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!openaiKey.trim()) return
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <CardTitle className="text-xl">Set up your API key</CardTitle>
        <CardDescription>
          To run AI agents, you need an LLM API key. Paste your OpenAI key
          below.
        </CardDescription>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="onboarding-openai-key" className="text-sm font-medium">
          OpenAI API Key
        </label>
        <div className="relative">
          <Input
            id="onboarding-openai-key"
            type={showKey ? 'text' : 'password'}
            placeholder="sk-..."
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            className="pr-10"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {(mutation.error as Error).message}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </button>
        </div>
        <Button type="submit" disabled={mutation.isPending || !openaiKey.trim()}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? 'Saving...' : 'Save & Continue'}
          {!mutation.isPending && <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  )
}

function StepCreateAgent({
  companyId,
  onNext,
  onBack,
}: {
  companyId: string
  onNext: (agent: Agent) => void
  onBack: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState('research-crew')
  const [adapterType, setAdapterType] = useState('crewai')
  const [entrypoint, setEntrypoint] = useState('demo/my_crew.py')

  const mutation = useMutation({
    mutationFn: (payload: CreateAgentPayload) => createAgent(companyId, payload),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
      toast('Agent hired successfully', 'success')
      onNext(agent)
    },
    onError: (err: Error) => {
      toast(`Failed to create agent: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    mutation.mutate({
      name: name.trim(),
      role: 'worker',
      adapter_type: adapterType,
      adapter_config: { entrypoint, timeout: 120 },
      budget_monthly_cents: 50000,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <CardTitle className="text-xl">Hire your first agent</CardTitle>
        <CardDescription>
          Agents are AI workers that execute tasks. Let's create your first one.
        </CardDescription>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="onboarding-agent-name" className="text-sm font-medium">
            Name <span className="text-destructive">*</span>
          </label>
          <Input
            id="onboarding-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. research-crew"
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="onboarding-adapter" className="text-sm font-medium">
              Adapter Type
            </label>
            <Select
              id="onboarding-adapter"
              value={adapterType}
              onChange={(e) => setAdapterType(e.target.value)}
            >
              {ADAPTER_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="onboarding-entrypoint" className="text-sm font-medium">
              Entrypoint
            </label>
            <Input
              id="onboarding-entrypoint"
              value={entrypoint}
              onChange={(e) => setEntrypoint(e.target.value)}
              placeholder="demo/my_crew.py"
            />
          </div>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {(mutation.error as Error).message}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button type="submit" disabled={mutation.isPending || !name.trim()}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? 'Creating...' : 'Create Agent'}
          {!mutation.isPending && <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  )
}

function StepCreateTask({
  companyId,
  agent,
  onFinish,
  onBack,
}: {
  companyId: string
  agent: Agent | null
  onFinish: () => void
  onBack: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')

  const mutation = useMutation({
    mutationFn: (payload: CreateTaskPayload) => createTask(companyId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', companyId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', companyId] })
      toast('Task created — you are all set!', 'success')
      onFinish()
    },
    onError: (err: Error) => {
      toast(`Failed to create task: ${err.message}`, 'error')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    mutation.mutate({
      title: title.trim(),
      priority: 'medium',
      status: 'todo',
      assignee_agent_id: agent?.id ?? null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <CardTitle className="text-xl">Create your first task</CardTitle>
        <CardDescription>
          Tasks are units of work. Assign one to your agent and watch it run.
        </CardDescription>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="onboarding-task-title" className="text-sm font-medium">
            Task Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="onboarding-task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Research competitor landscape"
            required
            autoFocus
          />
        </div>

        {agent && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Assigned to</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{agent.name}</span>
              <Badge variant="outline" className="font-mono text-xs">
                {agent.adapter_type}
              </Badge>
            </div>
          </div>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {(mutation.error as Error).message}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button type="submit" disabled={mutation.isPending || !title.trim()}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? 'Creating...' : 'Finish'}
          {!mutation.isPending && <Check className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  )
}

function StepSuccess({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  const [showConfetti, setShowConfetti] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="space-y-6 text-center">
      <div className="relative flex justify-center">
        <div
          className={'flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-500 ' + (
            showConfetti
              ? 'scale-110 bg-green-500/20'
              : 'scale-100 bg-green-500/10'
          )}
        >
          <PartyPopper
            className={'h-8 w-8 text-green-500 transition-transform duration-500 ' + (
              showConfetti ? 'rotate-12 scale-110' : 'rotate-0 scale-100'
            )}
          />
        </div>
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            {[
              { x: -24, y: -16, color: 'bg-yellow-400' },
              { x: 28, y: -20, color: 'bg-blue-400' },
              { x: -32, y: 4, color: 'bg-pink-400' },
              { x: 36, y: -2, color: 'bg-green-400' },
              { x: -18, y: -28, color: 'bg-purple-400' },
              { x: 22, y: -32, color: 'bg-orange-400' },
              { x: -36, y: -22, color: 'bg-red-400' },
              { x: 32, y: -28, color: 'bg-teal-400' },
            ].map((dot, i) => (
              <div
                key={i}
                className={'absolute h-1.5 w-1.5 rounded-full ' + dot.color + ' animate-ping'}
                style={{
                  transform: 'translate(' + dot.x + 'px, ' + dot.y + 'px)',
                  animationDelay: (i * 100) + 'ms',
                  animationDuration: '1.5s',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <CardTitle className="text-xl">You&apos;re all set!</CardTitle>
        <CardDescription className="text-balance">
          Your orchestrator is configured and your first agent is ready to work.
          Head to the dashboard to monitor activity and manage your team.
        </CardDescription>
      </div>

      <Button onClick={onGoToDashboard} size="lg" className="w-full sm:w-auto">
        Go to Dashboard
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function OnboardingWizard({ companyId }: { companyId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [createdAgent, setCreatedAgent] = useState<Agent | null>(null)
  const [completed, setCompleted] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleDismiss = useCallback(() => {
    if (dontShowAgain) {
      dismissOnboarding()
    }
    queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
    navigate('/agents')
  }, [dontShowAgain, companyId, queryClient, navigate])

  const handleWelcomeNext = useCallback(() => {
    setStep(1)
  }, [])

  const handleApiKeyNext = useCallback(() => {
    setStep(2)
  }, [])

  const handleAgentCreated = useCallback((agent: Agent) => {
    setCreatedAgent(agent)
    setStep(3)
  }, [])

  const handleFinish = useCallback(() => {
    dismissOnboarding()
    setCompleted(true)
  }, [])

  const handleGoToDashboard = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', companyId] })
    queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
    navigate(createdAgent ? '/agents/' + createdAgent.id : '/')
  }, [companyId, queryClient, navigate, createdAgent])

  const totalSteps = 4

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-6">
        {!completed && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex-1" />
              <h1 className="text-2xl font-bold tracking-tight text-center flex-shrink-0">
                {step === 0 ? 'Get Started' : 'Setup Wizard'}
              </h1>
              <div className="flex flex-1 justify-end">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Close onboarding wizard"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {step > 0 && <StepIndicator current={step} total={totalSteps} />}
          </>
        )}

        <Card>
          <CardContent className="p-6">
            {completed ? (
              <StepSuccess onGoToDashboard={handleGoToDashboard} />
            ) : step === 0 ? (
              <StepWelcome
                onNext={handleWelcomeNext}
                onDismiss={handleDismiss}
                dontShowAgain={dontShowAgain}
                setDontShowAgain={setDontShowAgain}
              />
            ) : step === 1 ? (
              <StepApiKey
                companyId={companyId}
                onNext={handleApiKeyNext}
                onBack={() => setStep(0)}
              />
            ) : step === 2 ? (
              <StepCreateAgent
                companyId={companyId}
                onNext={handleAgentCreated}
                onBack={() => setStep(1)}
              />
            ) : (
              <StepCreateTask
                companyId={companyId}
                agent={createdAgent}
                onFinish={handleFinish}
                onBack={() => setStep(2)}
              />
            )}
          </CardContent>
        </Card>

        {!completed && (
          <ProgressDots current={step} total={totalSteps} />
        )}

        {!completed && (
          <p className="text-center text-xs text-muted-foreground">
            Step {step + 1} of {totalSteps}
          </p>
        )}
      </div>
    </div>
  )
}
