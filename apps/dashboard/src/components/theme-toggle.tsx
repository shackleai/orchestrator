import { Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type Theme } from '@/hooks/useTheme'

const themeConfig: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: 'Light mode — click for system' },
  dark: { icon: Moon, label: 'Dark mode — click for light' },
  system: { icon: Monitor, label: 'System mode — click for dark' },
}

export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme()
  const { icon: Icon, label } = themeConfig[theme]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className="h-8 w-8"
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
