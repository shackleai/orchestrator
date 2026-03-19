import { useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  LayoutGrid,
  ListTodo,
  Loader2,
  Monitor,
  Moon,
  Network,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { useToast } from '@/components/ui/toast'

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-4">
      <h2 className="text-lg font-semibold border-b border-border pb-2">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ColorSwatch({
  name,
  variable,
  className,
}: {
  name: string
  variable: string
  className: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-10 w-10 rounded-lg border border-border shrink-0 ${className}`}
      />
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground font-mono">{variable}</p>
      </div>
    </div>
  )
}

const NAV_SECTIONS = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'badges', label: 'Badges' },
  { id: 'cards', label: 'Cards' },
  { id: 'tables', label: 'Tables' },
  { id: 'pagination', label: 'Pagination' },
  { id: 'toasts', label: 'Toasts' },
  { id: 'icons', label: 'Icons' },
]

export function DesignGuidePage() {
  const { toast } = useToast()
  const [paginationPage, setPaginationPage] = useState(0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Design Guide</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal component reference for ShackleAI Orchestrator dashboard.
        </p>
      </div>

      {/* Quick nav */}
      <nav
        className="flex flex-wrap gap-2"
        aria-label="Design guide sections"
      >
        {NAV_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* Colors */}
      <Section id="colors" title="Color Palette">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ColorSwatch
            name="Background"
            variable="--color-background"
            className="bg-background"
          />
          <ColorSwatch
            name="Foreground"
            variable="--color-foreground"
            className="bg-foreground"
          />
          <ColorSwatch
            name="Primary"
            variable="--color-primary"
            className="bg-primary"
          />
          <ColorSwatch
            name="Secondary"
            variable="--color-secondary"
            className="bg-secondary"
          />
          <ColorSwatch
            name="Muted"
            variable="--color-muted"
            className="bg-muted"
          />
          <ColorSwatch
            name="Accent"
            variable="--color-accent"
            className="bg-accent"
          />
          <ColorSwatch
            name="Destructive"
            variable="--color-destructive"
            className="bg-destructive"
          />
          <ColorSwatch
            name="Card"
            variable="--color-card"
            className="bg-card"
          />
          <ColorSwatch
            name="Border"
            variable="--color-border"
            className="bg-border"
          />
          <ColorSwatch
            name="Ring"
            variable="--color-ring"
            className="bg-ring"
          />
          <ColorSwatch
            name="Amber (Brand)"
            variable="--color-amber"
            className="bg-amber"
          />
          <ColorSwatch
            name="Amber Foreground"
            variable="--color-amber-foreground"
            className="bg-amber-foreground"
          />
        </div>
      </Section>

      {/* Typography */}
      <Section id="typography" title="Typography Scale">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <h1 className="text-4xl font-bold tracking-tight">
                Heading 1 — text-4xl
              </h1>
              <p className="text-xs text-muted-foreground font-mono">
                text-4xl font-bold tracking-tight
              </p>
            </div>
            <div className="space-y-1">
              <h2 className="text-3xl font-semibold tracking-tight">
                Heading 2 — text-3xl
              </h2>
              <p className="text-xs text-muted-foreground font-mono">
                text-3xl font-semibold tracking-tight
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="text-2xl font-semibold tracking-tight">
                Heading 3 — text-2xl
              </h3>
              <p className="text-xs text-muted-foreground font-mono">
                text-2xl font-semibold tracking-tight
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="text-xl font-semibold">Heading 4 — text-xl</h4>
              <p className="text-xs text-muted-foreground font-mono">
                text-xl font-semibold
              </p>
            </div>
            <div className="space-y-1">
              <h5 className="text-lg font-semibold">Heading 5 — text-lg</h5>
              <p className="text-xs text-muted-foreground font-mono">
                text-lg font-semibold
              </p>
            </div>
            <div className="space-y-1">
              <h6 className="text-base font-semibold">
                Heading 6 — text-base
              </h6>
              <p className="text-xs text-muted-foreground font-mono">
                text-base font-semibold
              </p>
            </div>
            <hr className="border-border" />
            <div className="space-y-1">
              <p className="text-base">
                Body text — The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                text-base (default)
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm">
                Small text — The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                text-sm
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs">
                Extra small — The quick brown fox jumps over the lazy dog.
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                text-xs
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Muted text — Used for descriptions and secondary information.
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                text-sm text-muted-foreground
              </p>
            </div>
            <div className="space-y-1">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                Inline code
              </code>
              <p className="text-xs text-muted-foreground font-mono">
                font-mono text-sm bg-muted rounded
              </p>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Buttons */}
      <Section id="buttons" title="Buttons">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Variants</CardTitle>
            <CardDescription>
              All button variants from the Button component.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="default">Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sizes</CardTitle>
            <CardDescription>
              Small, default, large, and icon sizes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add item">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">States</CardTitle>
            <CardDescription>
              Disabled and loading states.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Disabled</Button>
              <Button disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </Button>
              <Button variant="outline" disabled>
                Disabled Outline
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">With Icons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button>
                <Plus className="h-4 w-4" />
                Create Agent
              </Button>
              <Button variant="outline">
                <Search className="h-4 w-4" />
                Search
              </Button>
              <Button variant="destructive">
                <X className="h-4 w-4" />
                Delete
              </Button>
              <Button variant="ghost">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Inputs */}
      <Section id="inputs" title="Form Inputs">
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="guide-text"
                  className="text-sm font-medium"
                >
                  Text Input
                </label>
                <Input
                  id="guide-text"
                  placeholder="Enter text..."
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="guide-password"
                  className="text-sm font-medium"
                >
                  Password Input
                </label>
                <Input
                  id="guide-password"
                  type="password"
                  placeholder="Enter password..."
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="guide-disabled"
                  className="text-sm font-medium"
                >
                  Disabled Input
                </label>
                <Input
                  id="guide-disabled"
                  disabled
                  placeholder="Disabled..."
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="guide-search"
                  className="text-sm font-medium"
                >
                  Search Input
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="guide-search"
                    placeholder="Search..."
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="guide-select"
                className="text-sm font-medium"
              >
                Select
              </label>
              <Select id="guide-select" className="max-w-xs">
                <option value="">Choose an option...</option>
                <option value="agent">Agent</option>
                <option value="tool">Tool</option>
                <option value="policy">Policy</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="guide-textarea"
                className="text-sm font-medium"
              >
                Textarea
              </label>
              <textarea
                id="guide-textarea"
                rows={3}
                placeholder="Enter description..."
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Badges */}
      <Section id="badges" title="Badges">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Variants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="info">Info</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage Examples</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Badge variant="success">Running</Badge>
              <Badge variant="warning">Pending</Badge>
              <Badge variant="destructive">Failed</Badge>
              <Badge variant="info">v0.1.0</Badge>
              <Badge variant="secondary">Draft</Badge>
              <Badge className="border-transparent bg-amber/15 text-amber">
                Pro
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Cards */}
      <Section id="cards" title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Card</CardTitle>
              <CardDescription>
                A simple card with a title and description.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Card content goes here. Cards use rounded-xl borders with
                the card background color and subtle shadow.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Card with Badge</CardTitle>
                <Badge variant="success">Active</Badge>
              </div>
              <CardDescription>
                Combining cards with other components.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                <span>3 agents running</span>
              </div>
            </CardContent>
          </Card>

          <Card className="sm:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Stats Card Pattern</CardTitle>
              <CardDescription>
                Used on the overview page for KPIs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    label: 'Total Agents',
                    value: '12',
                    icon: Bot,
                    change: '+2',
                  },
                  {
                    label: 'Tasks Today',
                    value: '47',
                    icon: ListTodo,
                    change: '+8',
                  },
                  {
                    label: 'Cost (24h)',
                    value: '$3.42',
                    icon: DollarSign,
                    change: '-12%',
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {stat.label}
                      </p>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="mt-1 text-2xl font-bold">{stat.value}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {stat.change} from yesterday
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Tables */}
      <Section id="tables" title="Tables">
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tasks</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    name: 'code-reviewer',
                    status: 'running',
                    tasks: 14,
                    cost: '$1.23',
                  },
                  {
                    name: 'test-runner',
                    status: 'idle',
                    tasks: 7,
                    cost: '$0.58',
                  },
                  {
                    name: 'deploy-bot',
                    status: 'error',
                    tasks: 3,
                    cost: '$0.12',
                  },
                  {
                    name: 'doc-writer',
                    status: 'running',
                    tasks: 22,
                    cost: '$2.01',
                  },
                ].map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium font-mono text-sm">
                      {row.name}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === 'running'
                            ? 'success'
                            : row.status === 'error'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.tasks}</TableCell>
                    <TableCell className="text-right font-mono">
                      {row.cost}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Section>

      {/* Pagination */}
      <Section id="pagination" title="Pagination">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagination Component</CardTitle>
            <CardDescription>
              Navigate between pages. Includes page size selector and
              ellipsis for large page counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Pagination
              page={paginationPage}
              pageSize={10}
              total={97}
              hasMore={paginationPage < 9}
              onPageChange={setPaginationPage}
            />
          </CardContent>
        </Card>
      </Section>

      {/* Toasts */}
      <Section id="toasts" title="Toasts">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Toast Notifications</CardTitle>
            <CardDescription>
              Click the buttons below to trigger toast notifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => toast('This is an info toast', 'info')}
              >
                Info Toast
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast('Agent deployed successfully', 'success')
                }
              >
                Success Toast
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast('Failed to connect to server', 'error')
                }
              >
                Error Toast
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Icons */}
      <Section id="icons" title="Icons Reference">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lucide Icons</CardTitle>
            <CardDescription>
              All icons currently used in the dashboard. From{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                lucide-react
              </code>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 sm:grid-cols-6 md:grid-cols-8">
              {[
                { Icon: Activity, name: 'Activity' },
                { Icon: AlertCircle, name: 'AlertCircle' },
                { Icon: ArrowLeft, name: 'ArrowLeft' },
                { Icon: Bot, name: 'Bot' },
                { Icon: Building2, name: 'Building2' },
                { Icon: Check, name: 'Check' },
                { Icon: ChevronDown, name: 'ChevronDown' },
                { Icon: ChevronLeft, name: 'ChevronLeft' },
                { Icon: ChevronRight, name: 'ChevronRight' },
                { Icon: DollarSign, name: 'DollarSign' },
                { Icon: ExternalLink, name: 'ExternalLink' },
                { Icon: Eye, name: 'Eye' },
                { Icon: EyeOff, name: 'EyeOff' },
                { Icon: Key, name: 'Key' },
                { Icon: LayoutGrid, name: 'LayoutGrid' },
                { Icon: ListTodo, name: 'ListTodo' },
                { Icon: Loader2, name: 'Loader2' },
                { Icon: Monitor, name: 'Monitor' },
                { Icon: Moon, name: 'Moon' },
                { Icon: Network, name: 'Network' },
                { Icon: Pause, name: 'Pause' },
                { Icon: Play, name: 'Play' },
                { Icon: Plus, name: 'Plus' },
                { Icon: Search, name: 'Search' },
                { Icon: Settings, name: 'Settings' },
                { Icon: Sparkles, name: 'Sparkles' },
                { Icon: Sun, name: 'Sun' },
                { Icon: X, name: 'X' },
                { Icon: XCircle, name: 'XCircle' },
              ].map(({ Icon, name }) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border p-3 text-center"
                >
                  <Icon className="h-5 w-5 text-foreground" />
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  )
}
