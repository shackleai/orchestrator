/**
 * `shackleai auth` — Register, login, and manage human user authentication
 */

import type { Command } from 'commander'
import * as p from '@clack/prompts'
import type { AuthResponse, UserPublic } from '@shackleai/shared'
import { apiClient } from '../api-client.js'
import { readConfig, writeConfig } from '../config.js'

interface ApiResponse<T> {
  data: T
  error?: string
}

async function registerUser(): Promise<void> {
  p.intro('Register a new user account')

  const name = await p.text({
    message: 'Full name',
    placeholder: 'Jane Doe',
    validate: (v) => {
      if (!v.trim()) return 'Name is required'
      return undefined
    },
  })

  if (p.isCancel(name)) {
    p.cancel('Cancelled.')
    return
  }

  const email = await p.text({
    message: 'Email address',
    placeholder: 'jane@example.com',
    validate: (v) => {
      if (!v.trim()) return 'Email is required'
      if (!v.includes('@')) return 'Invalid email address'
      return undefined
    },
  })

  if (p.isCancel(email)) {
    p.cancel('Cancelled.')
    return
  }

  const password = await p.password({
    message: 'Password (min 8 characters)',
    validate: (v) => {
      if (v.length < 8) return 'Password must be at least 8 characters'
      return undefined
    },
  })

  if (p.isCancel(password)) {
    p.cancel('Cancelled.')
    return
  }

  const spin = p.spinner()
  spin.start('Creating account...')

  const res = await apiClient('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      email: email.trim(),
      password,
    }),
  })

  if (!res.ok) {
    spin.stop('Registration failed')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<AuthResponse>
  spin.stop(`Account created: ${body.data.user.name} (${body.data.user.email})`)

  // Store the token in config
  const config = await readConfig()
  if (config) {
    await writeConfig({ ...config, authToken: body.data.token } as never)
  }

  p.outro('You are now logged in.')
}

async function loginUser(): Promise<void> {
  p.intro('Login to your account')

  const email = await p.text({
    message: 'Email address',
    placeholder: 'jane@example.com',
    validate: (v) => {
      if (!v.trim()) return 'Email is required'
      return undefined
    },
  })

  if (p.isCancel(email)) {
    p.cancel('Cancelled.')
    return
  }

  const password = await p.password({
    message: 'Password',
    validate: (v) => {
      if (!v) return 'Password is required'
      return undefined
    },
  })

  if (p.isCancel(password)) {
    p.cancel('Cancelled.')
    return
  }

  const spin = p.spinner()
  spin.start('Logging in...')

  const res = await apiClient('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: email.trim(),
      password,
    }),
  })

  if (!res.ok) {
    spin.stop('Login failed')
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<AuthResponse>
  spin.stop(`Logged in as ${body.data.user.name} (${body.data.user.email})`)

  // Store the token in config
  const config = await readConfig()
  if (config) {
    await writeConfig({ ...config, authToken: body.data.token } as never)
  }

  p.outro('Login successful.')
}

async function showMe(): Promise<void> {
  const config = await readConfig()
  const token = (config as Record<string, unknown> | null)?.authToken as string | undefined

  if (!token) {
    console.error('Not logged in. Run `shackleai auth login` first.')
    process.exit(1)
  }

  const res = await apiClient('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = (await res.json()) as ApiResponse<never>
    console.error(`Error: ${body.error ?? res.statusText}`)
    process.exit(1)
  }

  const body = (await res.json()) as ApiResponse<UserPublic>
  const u = body.data

  console.log(`Name:    ${u.name}`)
  console.log(`Email:   ${u.email}`)
  console.log(`Role:    ${u.role}`)
  console.log(`ID:      ${u.id}`)
}

async function logoutUser(): Promise<void> {
  const config = await readConfig()
  const token = (config as Record<string, unknown> | null)?.authToken as string | undefined

  if (!token) {
    console.log('Not logged in.')
    return
  }

  const spin = p.spinner()
  spin.start('Logging out...')

  await apiClient('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // Best effort — even if server is down, clear local token
  })

  // Remove token from config
  if (config) {
    const cleaned = { ...config } as Record<string, unknown>
    delete cleaned.authToken
    await writeConfig(cleaned as never)
  }

  spin.stop('Logged out.')
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage user authentication')

  auth
    .command('register')
    .description('Create a new user account')
    .action(async () => {
      await registerUser()
    })

  auth
    .command('login')
    .description('Login to your account')
    .action(async () => {
      await loginUser()
    })

  auth
    .command('logout')
    .description('Logout and invalidate your session')
    .action(async () => {
      await logoutUser()
    })

  auth
    .command('me')
    .description('Show current user info')
    .action(async () => {
      await showMe()
    })
}
