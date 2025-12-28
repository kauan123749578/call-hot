import * as React from "react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {/* Ícone vermelho com glow */}
      <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-red-600 shadow-lg shadow-red-500/50">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-red-500 to-red-700 opacity-80" />
        <svg
          viewBox="0 0 24 24"
          className="relative h-7 w-7 fill-white"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
        {/* Glow effect */}
        <div className="absolute -inset-1 rounded-xl bg-red-500 opacity-30 blur-md" />
      </div>
      
      {/* Tipografia moderna */}
      <div className="leading-tight">
        <div className="text-3xl font-black tracking-tight text-white drop-shadow-lg">
          CallHot
        </div>
      </div>
    </div>
  );
}
