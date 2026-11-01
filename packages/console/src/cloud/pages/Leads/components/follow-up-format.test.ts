import {
  formatFollowUpDraft,
  followUpParagraphs,
  hasUnfinishedSignature,
} from './follow-up-format';

it('separates greeting, short body paragraphs and closing without changing the words', () => {
  const source =
    'Hi Alex, Thanks for your interest. We can discuss your reporting workflow. Please share a suitable time. Best regards, [Your Name] [Your Company]';
  const formatted = formatFollowUpDraft(source);
  expect(followUpParagraphs(formatted)).toEqual([
    'Hi Alex,',
    'Thanks for your interest. We can discuss your reporting workflow.',
    'Please share a suitable time.',
    'Best regards, [Your Name] [Your Company]',
  ]);
  expect(formatted.replaceAll(/\s+/g, ' ')).toBe(source);
  expect(hasUnfinishedSignature(formatted)).toBe(true);
});

it('preserves intentionally formatted paragraphs and treats markup as plain text', () => {
  const source = 'Hi Alex,\n\n<script>not HTML</script>\nKeep this line.\n\nThe MeshX team';
  expect(formatFollowUpDraft(source)).toBe(source);
  expect(followUpParagraphs(source)).toHaveLength(3);
  expect(hasUnfinishedSignature(source)).toBe(false);
});
