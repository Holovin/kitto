function normalizeSseDataLine(line: string) {
  const value = line.slice(5);
  return value.startsWith(' ') ? value.slice(1) : value;
}

export function normalizeSseChunkLineEndings(chunk: string, pendingCarriageReturn: boolean, isDone: boolean) {
  let text = pendingCarriageReturn ? `\r${chunk}` : chunk;
  let nextPendingCarriageReturn = false;

  if (!isDone && text.endsWith('\r')) {
    text = text.slice(0, -1);
    nextPendingCarriageReturn = true;
  }

  return {
    normalizedText: text.replace(/\r\n?/g, '\n'),
    pendingCarriageReturn: nextPendingCarriageReturn,
  };
}

export function parseServerSentEvent(eventBlock: string) {
  const lines = eventBlock.split('\n').filter(Boolean);
  let event = 'message';
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      data.push(normalizeSseDataLine(line));
    }
  }

  return {
    event,
    data: data.join('\n'),
  };
}
