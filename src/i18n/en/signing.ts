// Collaborative PDF signing (celebrant + couple). The NOIM form content itself stays
// English (prescribed legal form); this is the signer chrome around it.
export const signing = {
  // Annotator chrome
  'signing.save.couple': 'Save signature',
  'signing.save.celebrant': 'Finalise',
  'signing.lead.couple':
    'Draw your signature on the document, then tap Save. You can redo it as often as you like first — your celebrant adds theirs next.',
  'signing.lead.celebrant':
    'The couple has signed. Add your signature to finalise it. The completed PDF is saved as a private document on this wedding — only you can open it.',
  'signing.toolbar.prev': 'Previous page',
  'signing.toolbar.next': 'Next page',
  'signing.toolbar.zoomOut': 'Zoom out',
  'signing.toolbar.zoomIn': 'Zoom in',
  'signing.toolbar.undo': 'Undo',
  'signing.toolbar.undoAria': 'Undo your last stroke',
  'signing.toolbar.erase': 'Erase',
  'signing.toolbar.eraseAria': 'Erase your signature on this page',
  'signing.page': 'Page {n} / {total}',
  'signing.loading': 'Loading document…',
  'signing.error.viewer': 'Could not load the PDF viewer.',
  'signing.error.load':
    'Could not load the document. Please refresh the page, and if it keeps happening, contact your celebrant.',
  'signing.saving.couple': 'Saving your signature…',
  'signing.saving.celebrant': 'Finalising…',
  'signing.saved': 'Saved',
  'signing.error.empty': 'Please draw your signature before saving. Use your finger, pen, or mouse to sign, then tap Save.',
  'signing.error.save': 'Could not save. Please try again.',
  'signing.error.network': 'Network error while saving. Please try again.',

  // Couple status pages
  'signing.status.notCouple.title': 'Signing link',
  'signing.status.notCouple.body': 'This signing link is for the couple. Open it from the account the celebrant invited.',
  'signing.status.locked.title': 'Ready when your celebrant is',
  'signing.status.locked.body':
    "Your celebrant will start the signing when you're together — in person or on a call. Keep this page open; it unlocks the moment they're ready.",
  'signing.status.coupleSigned.title': "Thanks — you've signed",
  'signing.status.coupleSigned.body':
    "Your celebrant will add their signature to finalise it. You're all done here — you can close this page.",
  'signing.status.coupleDone.title': 'All signed',
  'signing.status.coupleDone.body':
    'This document has been signed and finalised by your celebrant, who keeps the signed PDF on file.',
  'signing.status.cancelled.title': 'Signing cancelled',
  'signing.status.cancelled.body': 'This signing request is no longer active.',

  // Celebrant status pages
  'signing.celebrant.ready.title': 'Ready for the couple to sign',
  'signing.celebrant.ready.body':
    'You witness the couple sign. Either hand them this device to sign now, or release it so they can sign on their own device while you watch. You add your signature next to finalise it.',
  'signing.celebrant.ready.handoff': 'Sign on this device now',
  'signing.celebrant.ready.release': "Release for the couple's device",
  'signing.celebrant.released.title': 'Released — the couple can sign now',
  'signing.celebrant.released.body':
    "The couple can now sign on their own device — stay with them, in person or on a call, to witness. This page updates to your turn once they've signed. Lock it again if you need to stop.",
  'signing.celebrant.released.handoff': 'Sign on this device instead',
  'signing.celebrant.released.lock': 'Lock again',
  'signing.celebrant.done.title': 'Signed & finalised',
  'signing.celebrant.done.body':
    "The document is now complete. The final signed PDF is saved as a private document here — only you can open it. The couple has been emailed to confirm it's finalised.",
  'signing.celebrant.done.view': 'View signed PDF',
  'signing.celebrant.done.download': 'Download',

  // Couple dashboard card
  'signing.card.title': 'Signature needed',
  'signing.card.body':
    "Your celebrant will sign this with you. Open it when you're together — they start the signing, you draw your signature, then they finalise it.",
  'signing.card.open': 'Open',

  // Celebrant wedding "Signing" block
  'signing.block.title': 'Signing',
  'signing.block.docCount.one': '{count} document',
  'signing.block.docCount.other': '{count} documents',
  'signing.block.status.awaitingCouple': 'Waiting on the couple',
  'signing.block.status.awaitingCelebrant': 'Your turn to sign',
  'signing.block.status.complete': 'Signed',
  'signing.block.kind.noim': 'NOIM',
  'signing.block.kind.pdf': 'PDF',
  'signing.block.uploadSummary': 'Sign a PDF with the couple',
  'signing.block.uploadHint':
    "A PDF up to 10 MB. After uploading, you'll choose how the couple signs — on this device with you, or by releasing it to their own device — then you add your signature to finalise it.",
  'signing.block.docName': 'Document name (optional)',
  'signing.block.start': 'Start signing',

  // NOIM submission shortcut
  'signing.forms.download': 'Download NOIM PDF',
  'signing.forms.send': 'Send for signing',
  'signing.forms.hint': 'Link this NOIM to a wedding to start a signing session — the couple signs first, then you finalise it.',
} as const
