import { List } from "immutable";
import mitt, { Emitter, EventType } from "mitt";

import { bufferConcat, convertBufferToLines } from "./utils";

const fetcher = Promise.resolve().then(() => globalThis.fetch);

export const recurseReaderAsEvent: any = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    emitter: Emitter<Record<EventType, unknown>>
) => {
    const result = await reader.read();

    if (result.value) {
        emitter.emit("data", result.value);
    }

    if (!result.done) {
        return recurseReaderAsEvent(reader, emitter);
    }

    emitter.emit("done");
};

export default (url: RequestInfo | URL, options: any) => {
    const emitter = mitt();
    let overage: any = null;
    let encodedLog = new Uint8Array();

    emitter.on("data", (data: any) => {
        encodedLog = bufferConcat(encodedLog, new Uint8Array(data));

        const { lines, remaining } = convertBufferToLines(data, overage);

        overage = remaining;
        emitter.emit("update", { lines, encodedLog });
    });

    emitter.on("done", () => {
        if (overage) {
            emitter.emit("update", { lines: List.of(overage), encodedLog });
        }

        emitter.emit("end", encodedLog);
    });

    emitter.on("start", async () => {
        try {
            const fetch = await fetcher;
            const response = await fetch(
                url,
                Object.assign({ credentials: "omit" }, options)
            );

            if (!response.ok) {
                const error = new Error(response.statusText);

                // @ts-ignore
                error["status"] = response.status;
                emitter.emit("error", error);

                return;
            }

            const reader = response.body?.getReader();

            emitter.on("abort", () => reader?.cancel("ABORTED"));

            return recurseReaderAsEvent(reader!, emitter);
        } catch (err) {
            emitter.emit("error", err);
        }
    });

    return emitter;
};
