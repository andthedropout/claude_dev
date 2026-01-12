import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Sparkles, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Message {
  id: string;
  content: string;
  senderType: 'human' | 'agent' | 'system';
  createdAt: string;
}

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (content: string) => Promise<void>;
  isLoading?: boolean;
  placeholder?: string;
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.senderType === 'human';
  const isSystem = message.senderType === 'system';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
        isUser
          ? 'bg-primary'
          : isSystem
            ? 'bg-muted'
            : 'bg-gradient-to-br from-violet-500 to-purple-600'
      }`}>
        {isUser ? (
          <User className="w-3.5 h-3.5 text-primary-foreground" />
        ) : isSystem ? (
          <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-white" />
        )}
      </div>

      {/* Message content */}
      <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium text-foreground/80">
            {isUser ? 'You' : isSystem ? 'System' : 'Claude'}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className={`rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : isSystem
              ? 'bg-muted/50 text-muted-foreground rounded-bl-md'
              : 'bg-card border border-border rounded-bl-md'
        }`}>
          {isUser ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="text-[13px] leading-relaxed text-foreground/90 mb-2 last:mb-0">{children}</p>,
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="px-1.5 py-0.5 bg-accent rounded text-[12px] font-mono">{children}</code>
                    ) : (
                      <code className="block p-3 bg-accent rounded-lg text-[12px] font-mono overflow-x-auto my-2">{children}</code>
                    );
                  },
                  pre: ({ children }) => <pre className="bg-transparent p-0 m-0">{children}</pre>,
                  ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-[13px]">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-[13px]">{children}</ol>,
                  li: ({ children }) => <li className="text-foreground/90">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  a: ({ href, children }) => (
                    <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, onSendMessage, isLoading = false, placeholder = "Ask Claude about this document..." }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const content = input.trim();
    setInput('');
    setIsSending(true);

    try {
      await onSendMessage(content);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative h-full">
      {/* Messages area - absolute positioned for reliable scroll */}
      <div className="absolute inset-0 bottom-[140px] overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Notice that this is connected to terminal */}
          <div className="mb-4 p-3 rounded-lg bg-accent/50 border border-border/50">
            <p className="text-[11px] text-muted-foreground">
              Messages are sent to the <span className="text-foreground font-medium">Terminal</span> session.
              Switch to Terminal tab to see Claude's full response.
            </p>
          </div>

          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center mb-3">
                <Bot className="w-5 h-5 text-violet-400" />
              </div>
              <p className="text-[13px] font-medium text-foreground/80 mb-1">No messages yet</p>
              <p className="text-[11px] text-muted-foreground max-w-[200px]">
                Send a message to interact with Claude in the terminal.
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-card border border-border rounded-2xl rounded-bl-md">
                    <TypingIndicator />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area - fixed at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border bg-card/50">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isSending}
              rows={1}
              className="min-h-[44px] max-h-[120px] resize-none bg-background border-border/50 text-[13px] pr-12 placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            size="icon"
            className="h-[44px] w-[44px] shrink-0 rounded-xl"
          >
            {isSending ? (
              <StopCircle className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-2 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
