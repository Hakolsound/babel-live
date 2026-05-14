"use client";

import { useState } from "react";
import { ChevronDown, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LANGUAGES } from "@/lib/languages";

interface DefaultOption {
  value: string | null;
  label: string;
}

interface LanguageSelectorProps {
  value: string | null;
  onValueChange: (code: string | null) => void;
  disabled?: boolean;
  defaultOption?: DefaultOption;
  /** If provided, only these language codes are shown in the list */
  languages?: string[];
}

export function LanguageSelector({
  value,
  onValueChange,
  disabled = false,
  defaultOption = { value: null, label: "Auto-detect" },
  languages,
}: LanguageSelectorProps) {
  const visibleLanguages = languages
    ? LANGUAGES.filter((l) => languages.includes(l.code))
    : LANGUAGES;
  const [open, setOpen] = useState(false);

  const selectedName = value
    ? LANGUAGES.find((l) => l.code === value)?.name || value
    : defaultOption.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {selectedName}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search languages..." />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={defaultOption.label.toLowerCase().replace(/\s+/g, "-")}
                onSelect={() => {
                  onValueChange(defaultOption.value);
                  setOpen(false);
                }}
              >
                <Globe className="mr-2 h-4 w-4" />
                {defaultOption.label}
              </CommandItem>
              {visibleLanguages.map((language) => (
                <CommandItem
                  key={language.code}
                  value={`${language.name} ${language.code}`}
                  onSelect={() => {
                    onValueChange(language.code);
                    setOpen(false);
                  }}
                >
                  {language.name} ({language.code})
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
