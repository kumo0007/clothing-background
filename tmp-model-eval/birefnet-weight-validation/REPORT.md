# BiRefNet weight validation

| Check | OK | Detail |
| --- | --- | --- |
| app_public_url | yes | /models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx |
| disk_path | yes | D:\project\public\models\studioludens\birefnet-lite-512\onnx\model_fp16.onnx |
| exact_size | yes | 98484532 (expected 98484532 from HF LFS pointer) |
| sha256_vs_lfs_pointer | yes | got eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516; trusted LFS oid eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516 (huggingface.co/.../raw/main/onnx/model_fp16.onnx) |
| not_text_stub | yes | binary payload present |
| input_name | yes | names=input_image expected=input_image |
| output_name | yes | names=output_image expected=output_image |
| smoke_infer_cpu | yes | len=262144 dims=[1,1,512,512] nonFinite=0 min=-14.155738830566406 max=-9.334159851074219 loadMs=10872 inferMs=8215 |
