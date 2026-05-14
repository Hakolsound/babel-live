import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Captions, Mic, Users, Zap, Github } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Captions className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">Babel</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link
                href="https://github.com/thorwebdev/eleven-scribe-realtime-captions"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View source on GitHub"
              >
                <Github className="h-5 w-5" />
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/auth/signin">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/auth/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-balance">
            Real-time captions for your live events
          </h1>
          <p className="text-xl text-muted-foreground text-balance max-w-2xl mx-auto leading-relaxed">
            Broadcast live captions to your audience with ease. Perfect for
            conferences, webinars, and presentations.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button size="lg" asChild>
              <Link href="/auth/signup">Start broadcasting</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/auth/signin">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="space-y-3 text-center">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
              <Mic className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Easy Broadcasting</h3>
            <p className="text-muted-foreground leading-relaxed">
              Create an event and start broadcasting captions instantly to your
              audience
            </p>
          </div>
          <div className="space-y-3 text-center">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Public Viewing</h3>
            <p className="text-muted-foreground leading-relaxed">
              Share a simple link for anyone to follow along with live captions
            </p>
          </div>
          <div className="space-y-3 text-center">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Real-time Updates</h3>
            <p className="text-muted-foreground leading-relaxed">
              Captions appear instantly with smooth, real-time synchronization
            </p>
          </div>
        </div>
      </section>

      {/* Powered By Banner */}
      <section className="container mx-auto px-4 py-12">
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            <Badge
              variant="secondary"
              className="px-4 py-2 text-sm transition-colors hover:bg-primary/10"
            >
              <span className="text-muted-foreground">Powered by</span>
              <a
                href="https://elevenlabs.io/realtime-speech-to-text"
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <span className="ml-1.5 font-semibold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent group-hover:from-purple-500 group-hover:to-blue-500 transition-all">
                  ElevenLabs Scribe
                </span>
              </a>
              <span className="text-muted-foreground">and</span>
              <a
                href="https://supabase.com/realtime"
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <span className="ml-1.5 font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent group-hover:from-emerald-500 group-hover:to-teal-500 transition-all">
                  Supabase Realtime
                </span>
              </a>
            </Badge>
          </div>
        </div>
      </section>
    </div>
  );
}
