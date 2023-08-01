import { parse } from "@std/flags/mod.ts";

class InvalidTokenError extends Error {
}

class MiniBKel {
	async handler(req: Request): Promise<Response> {
		const formData = await req.formData();
		const token = formData.get("wstoken");
		if (typeof token !== "string") throw new InvalidTokenError();

		const urlParams = new URL(req.url).searchParams;
		let param, body;
		switch (param = urlParams.get("wsfunction")) {
			case "core_courses_get_courses_classification":
				body = this.#getCourses(token);
				break;

			case "core_courses_get_updates_since": {
				let courseId, since;

				if (typeof (courseId = urlParams.get("courseid")) != "string") {
					throw new TypeError(`course id expected to be string, got ${courseId}`);
				}

				// in milliseconds
				if (isNaN(since = parseInt(urlParams.get("since") ?? ""))) {
					throw new TypeError(`since expected to be number, got ${since}`);
				}
				since = new Date(since * 1000);

				body = this.#getUpdates(token, courseId, since);
				break;
			}
			default:
				throw new RangeError(`${param} is not valid wsfunction`);
		}

		return new Response(JSON.stringify(body));
	}

	onError(e: unknown) {
		let body = null;

		console.error(e);

		if (e instanceof InvalidTokenError) {
			body = { exceptioncode: "invalidtoken" };
		} else {
			return Deno.exit(1);
		}

		return new Response(JSON.stringify(body));
	}

	#getCourses(token: string): object {
		throw "unimplemented";
	}

	#getUpdates(token: string, courseId: string, since: Date): object {
		throw "unimplemented";
	}
}

if (import.meta.main) {
	const flags = parse(Deno.args, {
		string: "port",
		alias: { p: "port" },
	});

	let port: number;
	if (isNaN(port = flags.port ? parseInt(flags.port) : 0)) {
		throw new TypeError("port must be a number");
	}

	const bkel = new MiniBKel();

	Deno.serve({
		port,
		reusePort: true,
		onError: bkel.onError.bind(bkel),
		onListen: ({ hostname, port }) => {
			console.info(`server listening on http://${hostname}:${port}`);
		},
	}, bkel.handler);
}
