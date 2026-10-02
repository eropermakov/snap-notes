# Snap Notes OCR на Modal (необязательно)

Это **дополнительный** источник распознавания для продвинутых пользователей. Snap Notes прекрасно работает без него:
Tesseract, Gemini, Groq и остальные источники продолжают работать как обычно.

Скрипт `snap_notes_ocr.py` поднимает в **вашем** аккаунте [Modal](https://modal.com) OpenAI-совместимый HTTPS-эндпоинт с
open-source моделью для распознавания документов (по умолчанию [dots.ocr](https://huggingface.co/dots-studio/dots.ocr),
1,7 млрд параметров, 100+ языков). Snap Notes отправляет туда скриншот и получает Markdown (текст, таблицы, код),
который превращает в блоки заметки у вас на компьютере. Modal SDK в приложение не входит: общение идёт только по HTTPS.

## Установка

1. Установите Modal и войдите:

   ```bash
   pip install modal
   modal setup
   ```

2. Создайте **Proxy Auth Token**: <https://modal.com/settings/proxy-auth-tokens>. Вы получите пару
   `Token ID` (`wk-…`) и `Token Secret` (`ws-…`). Secret показывается один раз — сохраните его.

3. Разверните эндпоинт из корня репозитория:

   ```bash
   modal deploy integrations/modal/snap_notes_ocr.py
   ```

   В конце Modal напечатает адрес вида `https://<workspace>--snap-notes-ocr-serve.modal.run`.

4. В Snap Notes откройте **Настройки → ИИ и распознавание → Modal OCR** и введите:
   - **Token Secret** и **Token ID** из шага 2;
   - **OCR Endpoint** — адрес из шага 3.

   Затем нажмите **«Проверить подключение»**. Первый запрос после простоя может занять до нескольких минут:
   контейнер с GPU запускается и загружает модель (при следующих запусках веса берутся из кэша).

Проверить эндпоинт можно и вручную:

```bash
curl https://<workspace>--snap-notes-ocr-serve.modal.run/v1/models \
  -H "Modal-Key: wk-..." -H "Modal-Secret: ws-..."
```

## Настройки (переменные окружения при `modal deploy`)

| Переменная | По умолчанию | Что делает |
| --- | --- | --- |
| `SNAP_NOTES_OCR_MODEL` | `dots-studio/dots.ocr` | Любая модель Hugging Face, которую поддерживает vLLM (например, другая OCR/документная VLM). |
| `SNAP_NOTES_OCR_GPU` | `L4` | Тип GPU в Modal. |
| `SNAP_NOTES_OCR_IDLE` | `300` | Сколько секунд контейнер остаётся «тёплым» после последнего запроса. |

Пример: `SNAP_NOTES_OCR_GPU=A10G modal deploy integrations/modal/snap_notes_ocr.py`

## Стоимость и приватность

- GPU оплачивается Modal за время работы контейнера (запросы и период простоя). Условия и бесплатные кредиты
  Modal определяет сам — смотрите <https://modal.com/settings/usage>. Snap Notes ничего не обещает про цену.
- Скриншоты уходят только на ваш эндпоинт в вашем аккаунте Modal. Доступ закрыт Proxy Auth Token: без
  `Modal-Key`/`Modal-Secret` Modal отвечает 401.
- Чтобы остановить всё: `modal app stop snap-notes-ocr`.

## Чего эта интеграция не делает

Модель распознавания документов не предназначена для правки или переписывания текста, поэтому Modal OCR участвует
только в распознавании скриншотов. «Привести в порядок» и ИИ-действия над текстом выполняют текстовые источники.

## English summary

Optional advanced provider. `modal deploy integrations/modal/snap_notes_ocr.py` serves an open-source OCR VLM through
vLLM behind an OpenAI-compatible endpoint, protected by Modal Proxy Auth Tokens. Enter Token ID, Token Secret and the
endpoint URL in Snap Notes. Not deployed or load-tested by the Snap Notes maintainers in this repository: review the
vLLM/model versions in the script before deploying.
