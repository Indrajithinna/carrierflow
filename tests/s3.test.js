import test from "node:test";
import assert from "node:assert/strict";
import { createS3Service } from "../server/s3.js";
import { createApp, errorHandler } from "../server/app.js";
import { createStore } from "../server/db.js";

test("Amazon S3 service and storage integration", async (t) => {
  await t.test(
    "unconfigured S3 service gracefully handles upload and returns isConfigured=false",
    async () => {
      const s3 = createS3Service({});
      assert.equal(s3.isConfigured(), false);

      const res = await s3.uploadFile({
        key: "test.pdf",
        buffer: Buffer.from("dummy pdf content"),
        contentType: "application/pdf",
      });

      assert.equal(res.s3, false);
      assert.equal(res.size, Buffer.from("dummy pdf content").length);
      assert.match(res.message, /not configured/i);

      const presigned = await s3.getPresignedDownloadUrl({ key: "test.pdf" });
      assert.equal(presigned, null);

      const presignedUpload = await s3.getPresignedUploadUrl({
        key: "test.pdf",
      });
      assert.equal(presignedUpload, null);
    },
  );

  await t.test(
    "configured S3 service initializes client and generates commands",
    async () => {
      const env = {
        AWS_REGION: "ap-south-1",
        AWS_ACCESS_KEY_ID: "mock-access-key-id",
        AWS_SECRET_ACCESS_KEY: "mock-secret-access-key",
        S3_BUCKET_NAME: "careerflow-test-bucket",
      };

      const s3 = createS3Service(env);
      assert.equal(s3.isConfigured(), true);
      assert.equal(s3.bucket, "careerflow-test-bucket");
      assert.equal(s3.region, "ap-south-1");
      assert.ok(s3.client);

      // Mock client.send to verify PutObjectCommand, GetObjectCommand, and DeleteObjectCommand
      s3.client.send = async (command) => {
        const name = command.constructor.name;
        if (name === "PutObjectCommand") {
          return { ETag: '"test-etag-123"' };
        }
        if (name === "GetObjectCommand") {
          return {
            Body: {
              transformToByteArray: async () =>
                new Uint8Array(Buffer.from("Hello S3 content")),
            },
            ContentType: "application/pdf",
            Metadata: { userId: "user-1" },
          };
        }
        if (name === "DeleteObjectCommand") {
          return { $metadata: { httpStatusCode: 204 } };
        }
        return {};
      };

      const uploadRes = await s3.uploadFile({
        key: "resumes/alex/resume.pdf",
        buffer: Buffer.from("Hello S3 content"),
        contentType: "application/pdf",
        metadata: { userId: "user-1" },
      });

      assert.equal(uploadRes.s3, true);
      assert.equal(uploadRes.bucket, "careerflow-test-bucket");
      assert.equal(uploadRes.key, "resumes/alex/resume.pdf");
      assert.equal(uploadRes.etag, '"test-etag-123"');
      assert.ok(
        uploadRes.url.includes(
          "careerflow-test-bucket.s3.ap-south-1.amazonaws.com",
        ),
      );

      const getRes = await s3.getFile({ key: "resumes/alex/resume.pdf" });
      assert.equal(getRes.buffer.toString(), "Hello S3 content");
      assert.equal(getRes.contentType, "application/pdf");

      const deleteRes = await s3.deleteFile({ key: "resumes/alex/resume.pdf" });
      assert.equal(deleteRes.success, true);
    },
  );

  await t.test(
    "storage HTTP endpoints support status, upload, and retrieval",
    async () => {
      const store = createStore(":memory:");
      const mockS3 = {
        isConfigured: () => true,
        bucket: "careerflow-bucket",
        region: "us-east-1",
        uploadFile: async ({ key, buffer, contentType }) => ({
          s3: true,
          bucket: "careerflow-bucket",
          key,
          size: buffer.length,
          url: `https://careerflow-bucket.s3.us-east-1.amazonaws.com/${key}`,
        }),
        getFile: async ({ key }) => ({
          buffer: Buffer.from("Mock file payload"),
          contentType: "text/plain",
        }),
        getPresignedDownloadUrl: async ({ key }) =>
          `https://careerflow-bucket.s3.us-east-1.amazonaws.com/${key}?signed=true`,
      };

      const app = createApp(
        store,
        { REQUIRE_AUTH: "false" },
        { s3Service: mockS3 },
      );
      app.use(errorHandler);
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = "http://127.0.0.1:" + server.address().port;

      try {
        // 1. GET /api/storage/status
        const statusRes = await fetch(base + "/api/storage/status").then((r) =>
          r.json(),
        );
        assert.equal(statusRes.s3.configured, true);
        assert.equal(statusRes.s3.bucket, "careerflow-bucket");

        // 2. POST /api/storage/upload
        const uploadRes = await fetch(base + "/api/storage/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "sample-resume.pdf",
            data: Buffer.from("PDF sample file data").toString("base64"),
            contentType: "application/pdf",
          }),
        });

        assert.equal(uploadRes.status, 201);
        const uploaded = await uploadRes.json();
        assert.equal(uploaded.s3, true);
        assert.ok(uploaded.key.includes("sample-resume.pdf"));
        assert.ok(uploaded.downloadUrl.includes("careerflow-bucket"));

        // 3. GET /api/storage/files/:key (returns 302 redirect to presigned URL)
        const redirectRes = await fetch(
          base + "/api/storage/files/" + encodeURIComponent(uploaded.key),
          {
            redirect: "manual",
          },
        );
        assert.equal(redirectRes.status, 302);
        assert.ok(redirectRes.headers.get("location").includes("signed=true"));
      } finally {
        await app.locals.queue.stop();
        server.close();
        store.db.close();
      }
    },
  );
});
