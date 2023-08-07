import { parse } from "@std/flags/mod.ts";
import { FakeTime } from "@std/testing/time.ts";

class InvalidTokenError extends Error {}
class RequireLoginError extends Error {}

type Course = {
	id: number;
};

type Module = {
	id: number;
};

class MiniBKel {
	kv: Deno.Kv;

	constructor(kv: Deno.Kv) {
		this.kv = kv;
	}

	async handler(req: Request): Promise<Response> {
		const urlParams = new URL(req.url).searchParams;
		const token = urlParams.get("wstoken");
		if (typeof token !== "string") throw new InvalidTokenError();

		let param, body;
		switch (param = urlParams.get("wsfunction")) {
			case "core_course_get_recent_courses":
				body = await this.#getCourses(token);
				break;

			case "core_course_get_updates_since": {
				let courseId, since;

				if (isNaN(courseId = parseInt(urlParams.get("courseid") ?? ""))) {
					throw new TypeError(`course id expected to be string, got ${courseId}`);
				}

				// in milliseconds
				if (isNaN(since = parseInt(urlParams.get("since") ?? ""))) {
					throw new TypeError(`since expected to be number, got ${since}`);
				}
				since = new Date(since * 1000);

				body = await this.#getUpdates(token, courseId, since);
				break;
			}
			default:
				throw new RangeError(`${param} is not valid wsfunction`);
		}

		return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
	}

	onError(e: unknown) {
		let body = null;

		console.error(e);

		if (e instanceof InvalidTokenError) {
			body = { errorcode: "invalidtoken", message: "Invalid token" };
		} else if (e instanceof RequireLoginError) {
			body = { errorcode: "requireloginerror", message: "Khóa học hoặc hoạt động không thể truy cập." };
		} else {
			return Deno.exit(1);
		}

		return new Response(JSON.stringify(body));
	}

	async putCourse(token: string, course: Course) {
		await this.kv.atomic()
			.set(["token_by_course", course.id, token], token)
			.set(["course_by_token", token, course.id], course)
			.commit();
	}

	async updateCourse(course: Course, module: Module) {
		const since = new Date();
		await this.kv.atomic()
			.set(["update_by_course_and_module", course.id, module.id], since)
			.commit();
	}

	async #getCourses(token: string): Promise<object> {
		const ret = [];
		for await (const entry of this.kv.list({ prefix: ["course_by_token", token] })) {
			ret.push(entry.value);
		}
		return ret;
	}

	async #getUpdates(token: string, courseId: number, since: Date): Promise<object> {
		let entry;
		const ret: Module[] = [];

		entry = await this.kv.get(["course_by_token", token, courseId]);
		if (!entry.versionstamp) throw new RequireLoginError();

		for await (entry of this.kv.list<Date>({ prefix: ["update_by_course_and_module", courseId] })) {
			if (entry.value < since) continue;
			ret.push({
				id: entry.key[2] as number,
			});
		}

		return { instances: ret };
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

	const kv = await Deno.openKv("db.sqlite3");
	const bkel = new MiniBKel(kv);
	const time = new FakeTime(0);

	await bkel.putCourse("a", { id: 1 });

	time.now = 1000;
	await bkel.updateCourse({ id: 1 }, { id: 1 });

	time.now = 3000;
	await bkel.updateCourse({ id: 1 }, { id: 2 });

	Deno.serve({
		port,
		reusePort: true,
		onError: bkel.onError.bind(bkel),
		onListen: ({ hostname, port }) => {
			console.info(`server listening on http://${hostname}:${port}`);
		},
	}, bkel.handler.bind(bkel));
}
