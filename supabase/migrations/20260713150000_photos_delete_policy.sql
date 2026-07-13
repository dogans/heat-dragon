-- Staff can delete photo files (used by the ops app's delete-enquiry action).
create policy "staff can delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
