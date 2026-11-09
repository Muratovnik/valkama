/**
 * The words of a picture pasted into a text: what the editor says while it sends one or
 * when it refuses one, and what the drawn picture is called (`useEditorImages`,
 * `RichImage`). A file of its own because the locale catalogues are held to their size.
 */
export const pastedImageMessages = {
  en: {
    pastedImages: {
      sending: 'Attaching the picture…',
      attached: 'Picture attached.',
      notImage: 'Only a PNG, JPEG, WebP or GIF picture can be attached.',
      tooLarge: 'The picture is larger than 10 MB and was not attached.',
      failed: 'The picture could not be attached. Try again.',
      open: 'Open the picture full size: {name}',
      close: 'Close the picture',
      unnamed: 'Picture',
    },
  },
  ru: {
    pastedImages: {
      sending: 'Прикрепляю картинку…',
      attached: 'Картинка прикреплена.',
      notImage: 'Прикрепить можно только картинку PNG, JPEG, WebP или GIF.',
      tooLarge: 'Картинка больше 10 МБ и не прикреплена.',
      failed: 'Не удалось прикрепить картинку. Попробуйте ещё раз.',
      open: 'Открыть картинку целиком: {name}',
      close: 'Закрыть картинку',
      unnamed: 'Картинка',
    },
  },
} as const
