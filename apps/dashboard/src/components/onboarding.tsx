import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Key,
  Bot,
  ListTodo,
  ChevronRight,
  Loader2,
  Eye,
  EyeOff,
  Check,
  SkipForward,
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

const STEPS = [
  { label: 'API Key', icon: Key },
  { label: 'Agent', icon: Bot },
  { label: 'Task', icon: ListTodo },
] as const

const ADAPTER_TYPES = ['crewai', 'process', 'http', 'claude', 'mcp', 'openclaw'] as const

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

function StepApiKey({
  companyId,
  onNext,
}: {
  companyId: string
  onNext: () => void
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
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip for now
        </button>
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
}: {
  companyId: string
  onNext: (agent: Agent) => void
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

      <div className="flex justify-end">
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
}: {
  companyId: string
  agent: Agent | null
  onFinish: () => void
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
      status: 'open',
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

      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending || !title.trim()}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? 'Creating...' : 'Finish'}
          {!mutation.isPending && <Check className="h-4 w-4" />}
        </Button>
      </div>
    </form>
  )
}

export function OnboardingWizard({ companyId }: { companyId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [createdAgent, setCreatedAgent] = useState<Agent | null>(null)

  const handleApiKeyNext = useCallback(() => {
    setStep(1)
  }, [])

  const handleAgentCreated = useCallback((agent: Agent) => {
    setCreatedAgent(agent)
    setStep(2)
  }, [])

  const handleFinish = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', companyId] })
    queryClient.invalidateQueries({ queryKey: ['agents', companyId] })
    navigate('/agents')
  }, [companyId, queryClient, navigate])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to ShackleAI
          </h1>
          <p className="text-sm text-muted-foreground">
            Let's get your orchestrator up and running in a few steps.
          </p>
        </div>

        <StepIndicator current={step} total={3} />

        <Card>
          <CardContent className="p-6">
            {step === 0 && (
              <StepApiKey companyId={companyId} onNext={handleApiKeyNext} />
            )}
            {step === 1 && (
              <StepCreateAgent
                companyId={companyId}
                onNext={handleAgentCreated}
              />
            )}
            {step === 2 && (
              <StepCreateTask
                companyId={companyId}
                agent={createdAgent}
                onFinish={handleFinish}
              />
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Step {step + 1} of 3
        </p>
      </div>
    </div>
  )
}
